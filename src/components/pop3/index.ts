import net from "node:net";
import tls from "node:tls";
import type { Configuration } from "../configuration/index.js";
import { normalizeAddress } from "../text/index.js";
import { rawBufferFromMessage, splitHeaderAndBody } from "../mime/index.js";
import type { AccountRepository } from "../account/index.js";
import type { ActivityLogger } from "../activity/index.js";
import type { MessageRepository } from "../message/index.js";
import type { MessageRecord } from "../message/interfaces/mailTypes.js";
import type { ServerCertificate } from "../certificate/index.js";
import type { SignInGuard } from "../signIn/interfaces/signInGuard.js";
import { ActivityAction } from "../activity/enums/activityAction.js";
import { ActivityResult } from "../activity/enums/activityResult.js";
import { MailFolderName } from "../message/enums/mailFolderName.js";
import { Pop3Command } from "./enums/pop3Command.js";
import { MailProtocol } from "../protocol/enums/mailProtocol.js";
import { listen } from "../protocol/utils/listen.js";
import { createProtocolReader, dotStuff } from "../protocol/index.js";
import { secureOptions, upgradeToTls } from "../protocol/utils/transportSecurity.js";

function firstLines(buffer: Buffer, lineCount: number): Buffer {
  if (lineCount <= 0) {
    return Buffer.alloc(0);
  }
  let found = 0;
  for (let index = 0; index < buffer.length - 1; index += 1) {
    if (buffer[index] === 0x0d && buffer[index + 1] === 0x0a) {
      found += 1;
      if (found === lineCount) {
        return buffer.subarray(0, index + 2);
      }
    }
  }
  return buffer;
}

export class Pop3Server {
  constructor(private readonly input: {
    configuration: Configuration;
    port: number;
    secure: boolean;
    certificate: ServerCertificate;
    accountRepository: AccountRepository;
    messageRepository: MessageRepository;
    signInGuard: SignInGuard;
    activityLogger: ActivityLogger;
  }) {}

  async start(): Promise<{ server: net.Server; port: number }> {
    const input = this.input;
    const handleConnection = (socket: net.Socket) => {
    socket.setTimeout(30 * 60 * 1000, () => socket.destroy());
    const reader = createProtocolReader({ acceptLiterals: false, maximumDataBytes: input.configuration.maximumMessageBytes });
    const session = {
      accountAddress: "",
      secure: input.secure,
      username: "",
      messages: [] as MessageRecord[],
      deleted: new Set<string>(),
      authenticationStep: "" as "" | "plain" | "login-username" | "login-password"
    };
    reader.attach(socket);
    reader.send(`+OK Open Mail Server POP3 ready\r\n`);
    reader.onLine = (line) => handleLine(line);

    function visibleMessages() {
      return session.messages
        .map((message, index) => ({ message, number: index + 1 }))
        .filter((item) => !session.deleted.has(item.message.identifier));
    }

    function findMessage(numberText: string) {
      const number = Number(numberText);
      if (!Number.isInteger(number) || number < 1 || number > session.messages.length) {
        return null;
      }
      const message = session.messages[number - 1];
      if (session.deleted.has(message.identifier)) {
        return null;
      }
      return { message, number };
    }

    async function signIn(username: string, password: string): Promise<void> {
      const key = `sign-in:${normalizeAddress(username) || username}`;
      const blocked = input.signInGuard.rejectionMessage(key);
      if (blocked) {
        reader.send(`-ERR ${blocked}\r\n`);
        return;
      }
      const account = await input.accountRepository.verifyCredentials(username, password);
      if (!account) {
        input.signInGuard.recordFailure(key);
        await input.activityLogger.record({
          protocol: MailProtocol.Pop3,
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
        reader.send("-ERR Invalid credentials\r\n");
        return;
      }
      input.signInGuard.recordSuccess(key);
      session.accountAddress = account.address;
      await input.messageRepository.ensureMailbox(account.address);
      session.messages = await input.messageRepository.listMessages(account.address, MailFolderName.Inbox);
      reader.send(`+OK Signed in, ${session.messages.length} messages\r\n`);
    }

    async function handleLine(line: string): Promise<void> {
      if (session.authenticationStep === "plain") {
        session.authenticationStep = "";
        const decoded = Buffer.from(line.trim(), "base64").toString("utf8").split("\u0000");
        await signIn(decoded[1] || "", decoded[2] || "");
        return;
      }
      if (session.authenticationStep === "login-username") {
        session.username = Buffer.from(line.trim(), "base64").toString("utf8");
        session.authenticationStep = "login-password";
        reader.send("+ UGFzc3dvcmQ6\r\n");
        return;
      }
      if (session.authenticationStep === "login-password") {
        const password = Buffer.from(line.trim(), "base64").toString("utf8");
        session.authenticationStep = "";
        await signIn(session.username, password);
        return;
      }
      const spaceIndex = line.indexOf(" ");
      const command = (spaceIndex === -1 ? line : line.slice(0, spaceIndex)).toUpperCase();
      const argument = spaceIndex === -1 ? "" : line.slice(spaceIndex + 1);

      if (command === Pop3Command.Capability) {
        const lines = ["+OK Capability list follows", Pop3Command.User, Pop3Command.UniqueIdentifierList, Pop3Command.Top, "SASL PLAIN LOGIN", "IMPLEMENTATION Open Mail Server"];
        if (!session.secure) {
          lines.push(Pop3Command.StartTls);
        }
        reader.send(`${lines.join("\r\n")}\r\n.\r\n`);
        return;
      }
      if (command === Pop3Command.StartTls) {
        if (session.secure || session.accountAddress) {
          reader.send("-ERR TLS is not available now\r\n");
          return;
        }
        reader.send("+OK Begin TLS\r\n");
        const secureSocket = await upgradeToTls(socket, input.certificate);
        reader.attach(secureSocket);
        session.secure = true;
        return;
      }
      if (command === Pop3Command.User) {
        if (session.accountAddress) {
          reader.send("-ERR Already signed in\r\n");
          return;
        }
        session.username = argument.trim();
        reader.send("+OK User accepted\r\n");
        return;
      }
      if (command === Pop3Command.Password) {
        if (session.accountAddress || !session.username) {
          reader.send("-ERR Send USER first\r\n");
          return;
        }
        await signIn(session.username, argument);
        return;
      }
      if (command === Pop3Command.Authenticate) {
        if (session.accountAddress || !session.secure) {
          reader.send("-ERR Authentication is not available\r\n");
          return;
        }
        const [mechanism, initial] = argument.split(" ");
        const name = (mechanism || "").toUpperCase();
        if (name === "PLAIN") {
          if (initial) {
            const decoded = Buffer.from(initial, "base64").toString("utf8").split("\u0000");
            await signIn(decoded[1] || "", decoded[2] || "");
            return;
          }
          session.authenticationStep = "plain";
          reader.send("+\r\n");
          return;
        }
        if (name === "LOGIN") {
          if (initial) {
            session.username = Buffer.from(initial, "base64").toString("utf8");
            session.authenticationStep = "login-password";
            reader.send("+ UGFzc3dvcmQ6\r\n");
            return;
          }
          session.authenticationStep = "login-username";
          reader.send("+ VXNlcm5hbWU6\r\n");
          return;
        }
        reader.send("-ERR Mechanism is not supported\r\n");
        return;
      }
      if (command === Pop3Command.Quit) {
        if (session.accountAddress && session.deleted.size) {
          await input.messageRepository.removeMessages(session.accountAddress, MailFolderName.Inbox, [...session.deleted]);
        }
        reader.send("+OK Goodbye\r\n");
        reader.close();
        return;
      }
      if (!session.accountAddress) {
        reader.send("-ERR Sign in required\r\n");
        return;
      }
      if (command === Pop3Command.NoOperation) {
        reader.send("+OK\r\n");
        return;
      }
      if (command === Pop3Command.Statistics) {
        const visible = visibleMessages();
        const size = visible.reduce((total, item) => total + (item.message.rawSize || 0), 0);
        reader.send(`+OK ${visible.length} ${size}\r\n`);
        return;
      }
      if (command === Pop3Command.Reset) {
        session.deleted.clear();
        reader.send("+OK\r\n");
        return;
      }
      if (command === Pop3Command.List) {
        if (!argument) {
          const visible = visibleMessages();
          const lines = visible.map((item) => `${item.number} ${item.message.rawSize || 0}`);
          reader.send(`+OK ${visible.length} messages\r\n${lines.length ? `${lines.join("\r\n")}\r\n` : ""}.\r\n`);
          return;
        }
        const found = findMessage(argument);
        if (!found) {
          reader.send("-ERR No such message\r\n");
          return;
        }
        reader.send(`+OK ${found.number} ${found.message.rawSize || 0}\r\n`);
        return;
      }
      if (command === Pop3Command.UniqueIdentifierList) {
        if (!argument) {
          const visible = visibleMessages();
          const lines = visible.map((item) => `${item.number} ${item.message.identifier}`);
          reader.send(`+OK\r\n${lines.length ? `${lines.join("\r\n")}\r\n` : ""}.\r\n`);
          return;
        }
        const found = findMessage(argument);
        if (!found) {
          reader.send("-ERR No such message\r\n");
          return;
        }
        reader.send(`+OK ${found.number} ${found.message.identifier}\r\n`);
        return;
      }
      if (command === Pop3Command.Retrieve || command === Pop3Command.Top) {
        const [numberText, lineText] = argument.split(" ");
        const found = findMessage(numberText);
        if (!found) {
          reader.send("-ERR No such message\r\n");
          return;
        }
        const record = await input.messageRepository.readMessage(session.accountAddress, MailFolderName.Inbox, found.message.identifier);
        const rawBuffer = rawBufferFromMessage(record);
        let payload = rawBuffer;
        if (command === Pop3Command.Top) {
          const lineCount = Number(lineText || 0);
          const parts = splitHeaderAndBody(rawBuffer);
          payload = Buffer.concat([parts.header, Buffer.from("\r\n\r\n"), firstLines(parts.body, Number.isFinite(lineCount) ? lineCount : 0)]);
        }
        reader.send("+OK Message follows\r\n");
        reader.send(dotStuff(payload));
        return;
      }
      if (command === Pop3Command.Delete) {
        const found = findMessage(argument);
        if (!found) {
          reader.send("-ERR No such message\r\n");
          return;
        }
        session.deleted.add(found.message.identifier);
        reader.send("+OK Message marked\r\n");
        return;
      }
      reader.send("-ERR Command not supported\r\n");
    }
  };

  const server = input.secure
    ? tls.createServer(secureOptions(input.certificate), handleConnection)
    : net.createServer(handleConnection);
    const port = await listen(server, input.port, input.configuration.host);
    return { server, port };
  }
}
