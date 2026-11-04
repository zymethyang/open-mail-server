import net from "node:net";
import tls from "node:tls";
import type { Configuration } from "../configuration/index.js";
import { oneLine } from "../text/index.js";
import type { MailFolder, MessageRecord } from "../message/interfaces/mailTypes.js";
import { normalizeAddress } from "../text/index.js";
import type { MailboxEvents } from "../mailboxEvents/interfaces/mailboxEvents.js";
import { createStoredMessage, parseRawMessage, quoteImap } from "../mime/index.js";
import type { AccountRepository } from "../account/index.js";
import type { ActivityLogger } from "../activity/index.js";
import type { MessageRepository } from "../message/index.js";
import type { PublicAccount } from "../account/interfaces/accountRecord.js";
import type { ServerCertificate } from "../certificate/index.js";
import type { SignInGuard } from "../signIn/interfaces/signInGuard.js";
import { ActivityAction } from "../activity/enums/activityAction.js";
import { ActivityResult } from "../activity/enums/activityResult.js";
import { MailProtocol } from "../protocol/enums/mailProtocol.js";
import { listen } from "../protocol/utils/listen.js";
import { createProtocolReader } from "../protocol/index.js";
import { secureOptions, upgradeToTls } from "../protocol/utils/transportSecurity.js";
import {
  applyFlags,
  compileSearch,
  expandAttributes,
  fetchItems,
  flagList,
  matchesPattern,
  parseStoreMode,
  selectedMessages,
  setsSeen,
  tokenizeImap,
  type FetchItem,
  type ImapToken
} from "./utils/imapMailbox.js";

function capabilityText(secure: boolean): string {
  const parts = ["IMAP4rev1", "LITERAL+", "IDLE", "MOVE", "NAMESPACE", "UNSELECT", "SPECIAL-USE", "ID", "AUTH=PLAIN", "LOGIN"];
  if (!secure) {
    parts.push("STARTTLS");
  }
  return parts.join(" ");
}

interface SelectedFolder {
  folder: MailFolder;
  readOnly: boolean;
  messages: MessageRecord[];
}

export class ImapServer {
  constructor(private readonly input: {
    configuration: Configuration;
    port: number;
    secure: boolean;
    certificate: ServerCertificate;
    accountRepository: AccountRepository;
    messageRepository: MessageRepository;
    signInGuard: SignInGuard;
    activityLogger: ActivityLogger;
    mailboxEvents: MailboxEvents;
    productName: string;
  }) {}

  async start(): Promise<{ server: net.Server; port: number }> {
    const input = this.input;
    const handleConnection = (socket: net.Socket) => {
    socket.setTimeout(30 * 60 * 1000, () => socket.destroy());
    const reader = createProtocolReader({ acceptLiterals: true, maximumDataBytes: input.configuration.maximumMessageBytes });
    const session: {
      account: PublicAccount | null;
      secure: boolean;
      selected: SelectedFolder | null;
      authenticationPlain: boolean;
      authenticationTag: string;
      idle: boolean;
      idleTag: string;
      stopIdleNotifications: () => void;
    } = {
      account: null,
      secure: input.secure,
      selected: null,
      authenticationPlain: false,
      authenticationTag: "",
      idle: false,
      idleTag: "",
      stopIdleNotifications: () => undefined
    };

    reader.onLiteralRequest = () => {
      reader.send("+ Ready\r\n");
    };
    reader.onLine = (line) => {
      if (session.idle) {
        finishIdle(line);
        return;
      }
      return handleLine(line);
    };
    reader.onLiteral = (line, literal) => handleAppend(line, literal);
    reader.onClose = () => {
      session.idle = false;
      session.stopIdleNotifications();
    };
    reader.attach(socket);
    reader.send(`* OK [CAPABILITY ${capabilityText(session.secure)}] ${input.productName} ready\r\n`);

    function finishIdle(line: string): void {
      session.idle = false;
      session.stopIdleNotifications();
      session.stopIdleNotifications = () => undefined;
      if (line.trim().toUpperCase() === "DONE") {
        reader.send(`${session.idleTag} OK IDLE completed\r\n`);
        return;
      }
      reader.send(`${session.idleTag} BAD Expected DONE\r\n`);
    }

    async function announceCount(): Promise<void> {
      if (!session.account || !session.selected) {
        return;
      }
      const messages = await input.messageRepository.listMessages(session.account.address, session.selected.folder.storageName);
      session.selected.messages = messages;
      reader.send(`* ${messages.length} EXISTS\r\n`);
    }

    function requireAccount(tag: string): boolean {
      if (session.account) {
        return true;
      }
      reader.send(`${tag} NO Sign in required\r\n`);
      return false;
    }

    function requireSelected(tag: string): boolean {
      if (!requireAccount(tag)) {
        return false;
      }
      if (!session.selected) {
        reader.send(`${tag} NO Select a folder first\r\n`);
        return false;
      }
      return true;
    }

    async function signIn(tag: string, username: string, password: string): Promise<void> {
      const key = `sign-in:${normalizeAddress(username) || username}`;
      const blocked = input.signInGuard.rejectionMessage(key);
      if (blocked) {
        reader.send(`${tag} NO ${blocked}\r\n`);
        return;
      }
      const account = await input.accountRepository.verifyCredentials(username, password);
      if (!account) {
        input.signInGuard.recordFailure(key);
        await input.activityLogger.record({
          protocol: MailProtocol.Imap,
          action: ActivityAction.SignIn,
          remoteAddress: socket.remoteAddress || "",
          mailboxAddress: normalizeAddress(username),
          senderAddress: "",
          recipientAddresses: [],
          subject: "",
          byteCount: 0,
          result: ActivityResult.Rejected,
          detail: "invalid credentials"
        });
        reader.send(`${tag} NO Invalid credentials\r\n`);
        return;
      }
      input.signInGuard.recordSuccess(key);
      session.account = account;
      await input.messageRepository.ensureMailbox(account.address);
      reader.send(`${tag} OK Sign in completed\r\n`);
    }

    function sendFetch(sequence: number, items: FetchItem[]): void {
      reader.send(`* ${sequence} FETCH (`);
      items.forEach((item, itemIndex) => {
        if (itemIndex > 0) {
          reader.send(" ");
        }
        if (item.buffer && item.prefix) {
          reader.send(`${item.prefix} {${item.buffer.length}}\r\n`);
          reader.send(item.buffer);
          return;
        }
        reader.send(item.text || "");
      });
      reader.send(")\r\n");
    }

    async function selectFolder(tag: string, folderName: string, readOnly: boolean): Promise<void> {
      if (!session.account) {
        return;
      }
      const folders = await input.messageRepository.listFolders(session.account.address);
      const folder = folders.find((item) => item.displayName.toLowerCase() === String(folderName).toLowerCase() || item.storageName === String(folderName).toLowerCase());
      if (!folder) {
        reader.send(`${tag} NO Unknown folder\r\n`);
        return;
      }
      const messages = await input.messageRepository.listMessages(session.account.address, folder.storageName);
      const state = await input.messageRepository.mailboxState(session.account.address);
      session.selected = { folder, readOnly, messages };
      const unseenIndex = messages.findIndex((message) => !message.seen);
      reader.send(`* ${messages.length} EXISTS\r\n`);
      reader.send("* 0 RECENT\r\n");
      reader.send("* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n");
      reader.send("* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft \\*)] Flags permitted\r\n");
      if (unseenIndex >= 0) {
        reader.send(`* OK [UNSEEN ${unseenIndex + 1}] First unseen\r\n`);
      }
      reader.send(`* OK [UIDVALIDITY ${state.validity}] Validity\r\n`);
      reader.send(`* OK [UIDNEXT ${state.nextUniqueIdentifier}] Next identifier\r\n`);
      reader.send(`${tag} OK [${readOnly ? "READ-ONLY" : "READ-WRITE"}] ${readOnly ? "EXAMINE" : "SELECT"} completed\r\n`);
    }

    async function handleFetch(tag: string, setText: string, attributeToken: ImapToken | undefined, useUniqueIdentifier: boolean): Promise<void> {
      if (!requireSelected(tag) || !session.account || !session.selected) {
        return;
      }
      const messages = await input.messageRepository.listMessages(session.account.address, session.selected.folder.storageName);
      session.selected.messages = messages;
      const attributes = expandAttributes(attributeToken);
      const chosen = selectedMessages(messages, setText, useUniqueIdentifier);
      for (const item of chosen) {
        let current = item.message;
        if (!session.selected.readOnly && attributes.some((attribute) => setsSeen(attribute)) && !current.seen) {
          current = await input.messageRepository.updateMessage(session.account.address, session.selected.folder.storageName, current.identifier, {
            seen: true
          });
        }
        const items = attributes.flatMap((attribute) => fetchItems(current, attribute));
        if (!items.length) {
          reader.send(`${tag} BAD Unknown fetch attribute\r\n`);
          return;
        }
        if (useUniqueIdentifier && !attributes.some((attribute) => attribute.toUpperCase().startsWith("UID"))) {
          items.unshift({ text: `UID ${current.uniqueIdentifier}` });
        }
        sendFetch(item.sequence, items);
      }
      reader.send(`${tag} OK FETCH completed\r\n`);
    }

    async function handleSearch(tag: string, tokens: ImapToken[], useUniqueIdentifier: boolean): Promise<void> {
      if (!requireSelected(tag) || !session.account || !session.selected) {
        return;
      }
      const messages = await input.messageRepository.listMessages(session.account.address, session.selected.folder.storageName);
      const predicate = compileSearch(tokens, messages, useUniqueIdentifier);
      const numbers = messages.flatMap((message, index) => (predicate(message) ? [useUniqueIdentifier ? message.uniqueIdentifier : index + 1] : []));
      reader.send(`* SEARCH${numbers.length ? ` ${numbers.join(" ")}` : ""}\r\n`);
      reader.send(`${tag} OK SEARCH completed\r\n`);
    }

    async function handleStore(tag: string, setText: string, modeToken: string, flagToken: ImapToken | undefined, useUniqueIdentifier: boolean): Promise<void> {
      if (!requireSelected(tag) || !session.account || !session.selected) {
        return;
      }
      if (session.selected.readOnly) {
        reader.send(`${tag} NO Folder is read only\r\n`);
        return;
      }
      const parsedMode = parseStoreMode(modeToken);
      if (!parsedMode || !Array.isArray(flagToken)) {
        reader.send(`${tag} BAD Invalid store command\r\n`);
        return;
      }
      const messages = await input.messageRepository.listMessages(session.account.address, session.selected.folder.storageName);
      const chosen = selectedMessages(messages, setText, useUniqueIdentifier);
      for (const item of chosen) {
        const changes = applyFlags(item.message, parsedMode.mode, flagToken.map((flag) => String(flag)));
        const updated = await input.messageRepository.updateMessage(session.account.address, session.selected.folder.storageName, item.message.identifier, changes);
        if (!parsedMode.silent) {
          const items: FetchItem[] = [{ text: flagList(updated) }];
          if (useUniqueIdentifier) {
            items.unshift({ text: `UID ${updated.uniqueIdentifier}` });
          }
          sendFetch(item.sequence, items);
        }
      }
      reader.send(`${tag} OK STORE completed\r\n`);
    }

    async function handleCopy(tag: string, setText: string, destinationName: string, useUniqueIdentifier: boolean, move: boolean): Promise<void> {
      if (!requireSelected(tag) || !session.account || !session.selected) {
        return;
      }
      if (move && session.selected.readOnly) {
        reader.send(`${tag} NO Folder is read only\r\n`);
        return;
      }
      const folders = await input.messageRepository.listFolders(session.account.address);
      const destination = folders.find((folder) => folder.displayName.toLowerCase() === destinationName.toLowerCase() || folder.storageName === destinationName.toLowerCase());
      if (!destination) {
        reader.send(`${tag} NO Unknown folder\r\n`);
        return;
      }
      const messages = await input.messageRepository.listMessages(session.account.address, session.selected.folder.storageName);
      const chosen = selectedMessages(messages, setText, useUniqueIdentifier);
      if (move) {
        for (const item of chosen) {
          await input.messageRepository.moveMessage(session.account.address, session.selected.folder.storageName, destination.storageName, item.message.identifier);
        }
        for (const sequence of chosen.map((item) => item.sequence).sort((left, right) => right - left)) {
          reader.send(`* ${sequence} EXPUNGE\r\n`);
        }
      } else {
        for (const item of chosen) {
          await input.messageRepository.appendMessage(session.account.address, destination.storageName, item.message);
        }
      }
      reader.send(`${tag} OK ${move ? "MOVE" : "COPY"} completed\r\n`);
    }

    async function removeDeletedMessages(): Promise<void> {
      if (!session.account || !session.selected) {
        return;
      }
      const messages = await input.messageRepository.listMessages(session.account.address, session.selected.folder.storageName);
      const deleted = messages.map((message, index) => ({ message, sequence: index + 1 })).filter((item) => item.message.deleted);
      await input.messageRepository.removeMessages(session.account.address, session.selected.folder.storageName, deleted.map((item) => item.message.identifier));
      for (const sequence of deleted.map((item) => item.sequence).sort((left, right) => right - left)) {
        reader.send(`* ${sequence} EXPUNGE\r\n`);
      }
    }

    async function handleAppend(line: string, literal: Buffer): Promise<void> {
      const withoutSize = line.replace(/\{\d+\+?\}$/, "").trim();
      const tokens = tokenizeImap(withoutSize);
      const tag = String(tokens[0] || "*");
      if (!requireAccount(tag) || !session.account) {
        return;
      }
      if (String(tokens[1] || "").toUpperCase() !== "APPEND") {
        reader.send(`${tag} BAD Literal is not supported here\r\n`);
        return;
      }
      const folders = await input.messageRepository.listFolders(session.account.address);
      const folderName = String(tokens[2] || "");
      const folder = folders.find((item) => item.displayName.toLowerCase() === folderName.toLowerCase() || item.storageName === folderName.toLowerCase());
      if (!folder) {
        reader.send(`${tag} NO Unknown folder\r\n`);
        return;
      }
      const flagToken = tokens.find((token) => Array.isArray(token));
      const parsed = parseRawMessage(literal);
      const stored = createStoredMessage(parsed, literal, session.account.address);
      const changes = applyFlags(stored, "add", Array.isArray(flagToken) ? flagToken.map(String) : []);
      const record = await input.messageRepository.appendMessage(session.account.address, folder.storageName, { ...stored, ...changes });
      const state = await input.messageRepository.mailboxState(session.account.address);
      reader.send(`${tag} OK [APPENDUID ${state.validity} ${record.uniqueIdentifier}] APPEND completed\r\n`);
    }

    async function handleLine(line: string): Promise<void> {
      if (session.authenticationPlain) {
        const tag = session.authenticationTag;
        session.authenticationPlain = false;
        if (line.trim() === "*") {
          reader.send(`${tag} BAD Authentication cancelled\r\n`);
          return;
        }
        const decoded = Buffer.from(line.trim(), "base64").toString("utf8").split("\u0000");
        await signIn(tag, decoded[1] || "", decoded[2] || "");
        return;
      }

      const tokens = tokenizeImap(line);
      const tag = String(tokens[0] || "*");
      let command = String(tokens[1] || "").toUpperCase();
      let argumentStart = 2;
      let useUniqueIdentifier = false;
      if (command === "UID") {
        useUniqueIdentifier = true;
        command = String(tokens[2] || "").toUpperCase();
        argumentStart = 3;
      }

      try {
        if (command === "CAPABILITY") {
          reader.send(`* CAPABILITY ${capabilityText(session.secure)}\r\n`);
          reader.send(`${tag} OK CAPABILITY completed\r\n`);
          return;
        }
        if (command === "NOOP" || command === "CHECK") {
          if (session.selected) {
            await announceCount();
          }
          reader.send(`${tag} OK ${command} completed\r\n`);
          return;
        }
        if (command === "LOGOUT") {
          reader.send(`* BYE ${input.productName} closing\r\n`);
          reader.send(`${tag} OK LOGOUT completed\r\n`);
          reader.close();
          return;
        }
        if (command === "ID") {
          reader.send(`* ID ("name" "${input.productName}")\r\n`);
          reader.send(`${tag} OK ID completed\r\n`);
          return;
        }
        if (command === "ENABLE" || command === "NAMESPACE") {
          if (command === "NAMESPACE") {
            reader.send('* NAMESPACE (("" "/")) NIL NIL\r\n');
          }
          reader.send(`${tag} OK ${command} completed\r\n`);
          return;
        }
        if (command === "STARTTLS") {
          if (session.secure || session.account) {
            reader.send(`${tag} NO STARTTLS is not available now\r\n`);
            return;
          }
          reader.send(`${tag} OK Begin TLS now\r\n`);
          const secureSocket = await upgradeToTls(socket, input.certificate);
          reader.attach(secureSocket);
          session.secure = true;
          return;
        }
        if (command === "LOGIN") {
          await signIn(tag, String(tokens[2] || ""), String(tokens[3] || ""));
          return;
        }
        if (command === "AUTHENTICATE") {
          if (String(tokens[2] || "").toUpperCase() !== "PLAIN") {
            reader.send(`${tag} NO Unsupported authentication\r\n`);
            return;
          }
          if (tokens[3]) {
            const decoded = Buffer.from(String(tokens[3]), "base64").toString("utf8").split("\u0000");
            await signIn(tag, decoded[1] || "", decoded[2] || "");
            return;
          }
          session.authenticationPlain = true;
          session.authenticationTag = tag;
          reader.send("+\r\n");
          return;
        }
        if (!requireAccount(tag) || !session.account) {
          return;
        }
        if (command === "LIST" || command === "LSUB") {
          const pattern = String(tokens[3] || tokens[2] || "*");
          const folders = await input.messageRepository.listFolders(session.account.address);
          const state = await input.messageRepository.mailboxState(session.account.address);
          for (const folder of folders) {
            const subscribed = state.subscriptions.includes(folder.storageName);
            if (command === "LSUB" && !subscribed) {
              continue;
            }
            if (!matchesPattern(folder.displayName, pattern)) {
              continue;
            }
            const attributes = ["\\HasNoChildren"];
            if (folder.specialUse) {
              attributes.push(folder.specialUse);
            }
            reader.send(`* ${command} (${attributes.join(" ")}) "/" ${quoteImap(folder.displayName)}\r\n`);
          }
          reader.send(`${tag} OK ${command} completed\r\n`);
          return;
        }
        if (command === "STATUS") {
          const folders = await input.messageRepository.listFolders(session.account.address);
          const folder = folders.find((item) => item.displayName.toLowerCase() === String(tokens[2] || "").toLowerCase());
          const requested = Array.isArray(tokens[3]) ? tokens[3].map((item) => String(item).toUpperCase()) : [];
          if (!folder) {
            reader.send(`${tag} NO Unknown folder\r\n`);
            return;
          }
          const messages = await input.messageRepository.listMessages(session.account.address, folder.storageName);
          const state = await input.messageRepository.mailboxState(session.account.address);
          const values: string[] = [];
          for (const item of requested) {
            if (item === "MESSAGES") values.push(`MESSAGES ${messages.length}`);
            if (item === "UNSEEN") values.push(`UNSEEN ${messages.filter((message) => !message.seen).length}`);
            if (item === "RECENT") values.push("RECENT 0");
            if (item === "UIDNEXT") values.push(`UIDNEXT ${state.nextUniqueIdentifier}`);
            if (item === "UIDVALIDITY") values.push(`UIDVALIDITY ${state.validity}`);
          }
          reader.send(`* STATUS ${quoteImap(folder.displayName)} (${values.join(" ")})\r\n`);
          reader.send(`${tag} OK STATUS completed\r\n`);
          return;
        }
        if (command === "SELECT" || command === "EXAMINE") {
          await selectFolder(tag, String(tokens[argumentStart] || tokens[2] || ""), command === "EXAMINE");
          return;
        }
        if (command === "CREATE") {
          await input.messageRepository.createFolder(session.account.address, String(tokens[2] || ""));
          reader.send(`${tag} OK CREATE completed\r\n`);
          return;
        }
        if (command === "DELETE") {
          await input.messageRepository.deleteFolder(session.account.address, String(tokens[2] || ""));
          reader.send(`${tag} OK DELETE completed\r\n`);
          return;
        }
        if (command === "RENAME") {
          await input.messageRepository.renameFolder(session.account.address, String(tokens[2] || ""), String(tokens[3] || ""));
          reader.send(`${tag} OK RENAME completed\r\n`);
          return;
        }
        if (command === "SUBSCRIBE" || command === "UNSUBSCRIBE") {
          await input.messageRepository.setSubscription(session.account.address, String(tokens[2] || ""), command === "SUBSCRIBE");
          reader.send(`${tag} OK ${command} completed\r\n`);
          return;
        }
        if (command === "CLOSE") {
          if (!requireSelected(tag) || !session.selected) {
            return;
          }
          if (!session.selected.readOnly) {
            await removeDeletedMessages();
          }
          session.selected = null;
          reader.send(`${tag} OK CLOSE completed\r\n`);
          return;
        }
        if (command === "UNSELECT") {
          session.selected = null;
          reader.send(`${tag} OK UNSELECT completed\r\n`);
          return;
        }
        if (command === "EXPUNGE") {
          if (!requireSelected(tag) || !session.selected) {
            return;
          }
          if (session.selected.readOnly) {
            reader.send(`${tag} NO Folder is read only\r\n`);
            return;
          }
          await removeDeletedMessages();
          reader.send(`${tag} OK EXPUNGE completed\r\n`);
          return;
        }
        if (command === "IDLE") {
          if (!requireSelected(tag)) {
            return;
          }
          session.idle = true;
          session.idleTag = tag;
          session.stopIdleNotifications = input.mailboxEvents.subscribe((change) => {
            if (!session.idle || !session.account || !session.selected) {
              return;
            }
            if (change.address === session.account.address && change.folderStorageName === session.selected.folder.storageName) {
              void announceCount();
            }
          });
          reader.send("+ idling\r\n");
          return;
        }
        if (command === "FETCH") {
          await handleFetch(tag, String(tokens[argumentStart] || ""), tokens[argumentStart + 1], useUniqueIdentifier);
          return;
        }
        if (command === "SEARCH") {
          await handleSearch(tag, tokens.slice(argumentStart), useUniqueIdentifier);
          return;
        }
        if (command === "STORE") {
          await handleStore(tag, String(tokens[argumentStart] || ""), String(tokens[argumentStart + 1] || ""), tokens[argumentStart + 2], useUniqueIdentifier);
          return;
        }
        if (command === "COPY" || command === "MOVE") {
          await handleCopy(tag, String(tokens[argumentStart] || ""), String(tokens[argumentStart + 1] || ""), useUniqueIdentifier, command === "MOVE");
          return;
        }
        if (command === "APPEND") {
          reader.send(`${tag} BAD APPEND requires a message literal\r\n`);
          return;
        }
        reader.send(`${tag} BAD Command not supported\r\n`);
      } catch (error) {
        const status = (error as { imapStatus?: string }).imapStatus || ((error as { statusCode?: number }).statusCode === 400 ? "NO" : "BAD");
        reader.send(`${tag} ${status} ${oneLine((error as Error).message)}\r\n`);
      }
    }
  };

  const server = input.secure
    ? tls.createServer(secureOptions(input.certificate), handleConnection)
    : net.createServer(handleConnection);
    const port = await listen(server, input.port, input.configuration.host);
    return { server, port };
  }
}
