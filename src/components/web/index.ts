import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import tls from "node:tls";
import { contentTypes } from "./constants/contentTypes.js";
import type { Configuration } from "../configuration/index.js";
import { HttpError } from "../httpError/index.js";
import { AccountRole } from "../account/enums/accountRole.js";
import { ActivityAction } from "../activity/enums/activityAction.js";
import { ActivityResult } from "../activity/enums/activityResult.js";
import { MailProtocol } from "../protocol/enums/mailProtocol.js";
import { RelaySecurity } from "../settings/enums/relaySecurity.js";
import type { MessageRecord } from "../message/interfaces/mailTypes.js";
import type { PublicAccount } from "../account/interfaces/accountRecord.js";
import { assertAddressList, isValidAddress, normalizeAddress, parseAddressList } from "../text/index.js";
import type { DeliveryService } from "../delivery/index.js";
import { checkPublicPorts } from "../publicPort/index.js";
import { createMessageIdentifier, createRawMessage, parseRawMessage, sanitizeMessageHtml, type OutboundAttachment } from "../mime/index.js";
import { createSnippet } from "../mime/index.js";
import { listen } from "../protocol/utils/listen.js";
import { secureOptions } from "../protocol/utils/transportSecurity.js";
import type { AccountRepository } from "../account/index.js";
import type { ActivityLogger } from "../activity/index.js";
import type { MessageRepository } from "../message/index.js";
import type { OrganizationRepository } from "../organization/index.js";
import type { SessionRepository } from "../session/index.js";
import type { SettingsRepository } from "../settings/index.js";
import type { CertificateDescription, ServerCertificate } from "../certificate/index.js";
import type { SignInGuard } from "../signIn/interfaces/signInGuard.js";
import type { ListenerStatus } from "./interfaces/listenerStatus.js";
import { projectDirectoryFrom } from "../configuration/utils/projectDirectory.js";
import { authenticatorImage, createOneTimePasswordSecret, oneTimePasswordUri } from "../oneTimePassword/index.js";
export type { ListenerStatus };

interface ServerRequest {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  url: URL;
  account: PublicAccount | null;
  body: Record<string, unknown>;
}

function publicDirectory(): string {
  return path.join(projectDirectoryFrom(import.meta.url), "dist", "web", "public");
}

function compiledPublicDirectory(): string {
  return path.join(projectDirectoryFrom(import.meta.url), "src", "web", "public");
}

async function resolvePublicFile(requestPath: string): Promise<string | null> {
  const roots = [publicDirectory(), compiledPublicDirectory()];
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  for (const root of roots) {
    const candidate = path.resolve(root, relativePath);
    if (!candidate.startsWith(path.resolve(root))) {
      return null;
    }
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        return candidate;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return null;
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 26 * 1024 * 1024) {
      throw new HttpError(413, "Request is too large");
    }
    chunks.push(buffer);
  }
  if (!size) {
    return {};
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "Invalid JSON");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "Invalid JSON");
  }
}

function readCookies(request: http.IncomingMessage): Record<string, string> {
  const header = request.headers.cookie || "";
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return cookies;
}

function connectionIsSecure(request: http.IncomingMessage): boolean {
  if (request.socket instanceof tls.TLSSocket && request.socket.encrypted) {
    return true;
  }
  const remoteAddress = request.socket.remoteAddress || "";
  const localPeer = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  if (!localPeer) {
    return false;
  }
  const forwarded = request.headers["x-forwarded-proto"];
  const firstValue = Array.isArray(forwarded) ? forwarded[0] : forwarded || "";
  return firstValue.split(",")[0].trim().toLowerCase() === "https";
}

function cookieLine(name: string, value: string, secure: boolean, maxAge: number): string {
  const secureFlag = secure ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureFlag}`;
}

function writeSessionCookie(response: http.ServerResponse, identifier: string, secure: boolean): void {
  response.setHeader("Set-Cookie", [
    cookieLine("session", identifier, secure, identifier ? 7 * 24 * 60 * 60 : 0),
    cookieLine("pending", "", secure, 0)
  ]);
}

interface PendingSignIn {
  address: string;
  expiresAt: number;
}

const pendingSignIns = new Map<string, PendingSignIn>();

function writePendingSignIn(response: http.ServerResponse, address: string, secure: boolean): void {
  const now = Date.now();
  for (const [identifier, pending] of pendingSignIns) {
    if (pending.expiresAt <= now) {
      pendingSignIns.delete(identifier);
    }
  }
  const identifier = randomBytes(24).toString("base64url");
  pendingSignIns.set(identifier, { address, expiresAt: now + 5 * 60 * 1000 });
  response.setHeader("Set-Cookie", [
    cookieLine("session", "", secure, 0),
    cookieLine("pending", identifier, secure, 5 * 60)
  ]);
}

function readPendingSignIn(request: http.IncomingMessage): string {
  const identifier = readCookies(request).pending || "";
  const pending = pendingSignIns.get(identifier);
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingSignIns.delete(identifier);
    return "";
  }
  return pending.address;
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function textValue(value: unknown): string {
  return String(value ?? "");
}

function readOutboundAttachments(value: unknown, maximumBytes: number): OutboundAttachment[] {
  if (!Array.isArray(value) || !value.length) {
    return [];
  }
  const attachments: OutboundAttachment[] = [];
  let total = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") {
      throw new HttpError(400, "Attachment is invalid");
    }
    const record = item as Record<string, unknown>;
    const content = Buffer.from(textValue(record.contentEncoded), "base64");
    total += content.length;
    if (total > maximumBytes) {
      throw new HttpError(413, "Attachments are too large");
    }
    const fileName = textValue(record.fileName).replace(/[\\/\r\n"]/g, "").slice(0, 120) || "attachment";
    const contentType = textValue(record.contentType).split(";")[0].trim() || "application/octet-stream";
    attachments.push({
      fileName,
      contentType,
      content,
      contentIdentifier: textValue(record.contentIdentifier).replace(/[<>\r\n]/g, "").slice(0, 120)
    });
  }
  return attachments;
}

function presentName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.endsWith('"') && !trimmed.slice(0, -1).includes('"')) {
    return trimmed.slice(0, -1).trim();
  }
  return trimmed;
}

function summary(record: MessageRecord) {
  return {
    identifier: record.identifier,
    folderName: record.folderName,
    fromName: presentName(record.fromName || ""),
    fromAddress: record.fromAddress || "",
    toAddresses: record.toAddresses || [],
    copyAddresses: record.copyAddresses || [],
    subject: record.subject || "(no subject)",
    date: record.date,
    seen: Boolean(record.seen),
    answered: Boolean(record.answered),
    flagged: Boolean(record.flagged),
    draft: Boolean(record.draft),
    snippet: createSnippet(record.text || ""),
    attachmentNames: (record.attachments || [])
      .filter((attachment) => !attachment.contentIdentifier || !(record.html || "").includes(attachment.contentIdentifier))
      .map((attachment) => attachment.fileName)
  };
}

function requireAccount(context: ServerRequest): PublicAccount {
  if (!context.account) {
    throw new HttpError(401, "Sign in required");
  }
  return context.account;
}

function requireAdministrator(context: ServerRequest): PublicAccount {
  const account = requireAccount(context);
  if (account.role !== AccountRole.Administrator) {
    throw new HttpError(403, "Administrator access is required");
  }
  return account;
}

export function createWebServer(dependencies: {
  configuration: Configuration;
  accountRepository: AccountRepository;
  organizationRepository: OrganizationRepository;
  messageRepository: MessageRepository;
  sessionRepository: SessionRepository;
  activityLogger: ActivityLogger;
  deliveryService: DeliveryService;
  signInGuard: SignInGuard;
  listenerStatus: ListenerStatus[];
  certificate: ServerCertificate;
  serverName(): Promise<string>;
  settingsRepository: SettingsRepository;
  readCertificate(): Promise<CertificateDescription>;
  replaceCertificate(certificatePem: string, privateKeyPem: string): Promise<CertificateDescription>;
}): http.Server | https.Server {
  async function hostingGuide(domain: string) {
    const hostname = (await dependencies.serverName()) || domain;
    const incoming = dependencies.listenerStatus.find((item) => item.name === "IMAP" && item.security === "TLS");
    const outgoing = dependencies.listenerStatus.find((item) => item.name === "SMTP" && item.security === "STARTTLS");
    return {
      publicHostname: hostname,
      domain,
      secureWeb: dependencies.configuration.secureWeb,
      dns: [
        { type: "A or AAAA", host: hostname, value: "The public address of this server" },
        { type: "MX", host: domain, value: `10 ${hostname}` },
        { type: "TXT", host: domain, value: "v=spf1 mx -all" }
      ],
      clients: {
        incomingHost: hostname,
        incomingPort: incoming?.port || dependencies.configuration.imapSecurePort,
        incomingSecurity: "TLS",
        outgoingHost: hostname,
        outgoingPort: outgoing?.port || dependencies.configuration.smtpSubmissionPort,
        outgoingSecurity: "STARTTLS"
      }
    };
  }

  async function route(context: ServerRequest): Promise<boolean> {
    const { request, response, url } = context;
    const pathName = url.pathname;
    const organization = await dependencies.organizationRepository.read();

    if (request.method === "GET" && pathName === "/api/bootstrap") {
      sendJson(response, 200, {
        productName: dependencies.configuration.productName,
        needsSetup: !organization,
        configuredDomain: dependencies.configuration.configuredDomain,
        organization,
        account: context.account,
        listeners: context.account?.role === "administrator" ? dependencies.listenerStatus : [],
        hosting: organization && context.account ? await hostingGuide(organization.domain) : null
      });
      return true;
    }

    if (request.method === "POST" && pathName === "/api/setup") {
      if (organization || (await dependencies.accountRepository.hasAccounts())) {
        throw new HttpError(409, "This server is already set up");
      }
      const domain = textValue(context.body.domain).trim().toLowerCase();
      const created = await dependencies.organizationRepository.create({
        domain,
        displayName: textValue(context.body.organizationName),
        requiredDomain: dependencies.configuration.configuredDomain
      });
      try {
        const account = await dependencies.accountRepository.createAccount({
          address: textValue(context.body.address),
          displayName: textValue(context.body.displayName),
          password: textValue(context.body.password),
          role: AccountRole.Administrator,
          domain: created.domain
        });
        await dependencies.messageRepository.ensureMailbox(account.address);
        const identifier = await dependencies.sessionRepository.create(account.address, account.role);
        writeSessionCookie(response, identifier, connectionIsSecure(request));
        sendJson(response, 201, { organization: created, account });
      } catch (error) {
        await dependencies.organizationRepository.remove();
        throw error;
      }
      return true;
    }

    if (request.method === "POST" && pathName === "/api/session") {
      const address = normalizeAddress(context.body.address);
      const key = `sign-in:${address}`;
      const blocked = dependencies.signInGuard.rejectionMessage(key);
      if (blocked) {
        throw new HttpError(429, blocked);
      }
      const account = await dependencies.accountRepository.verifyCredentials(address, textValue(context.body.password));
      if (!account) {
        dependencies.signInGuard.recordFailure(key);
        await dependencies.activityLogger.record({
          protocol: MailProtocol.Web,
          action: ActivityAction.SignIn,
          remoteAddress: request.socket.remoteAddress || "",
          mailboxAddress: address,
          senderAddress: "",
          recipientAddresses: [],
          subject: "",
          byteCount: 0,
          result: ActivityResult.Rejected,
          detail: "invalid credentials"
        });
        throw new HttpError(401, "Invalid credentials");
      }
      dependencies.signInGuard.recordSuccess(key);
      if (account.oneTimePasswordEnabled) {
        writePendingSignIn(response, account.address, connectionIsSecure(request));
        sendJson(response, 200, { oneTimePasswordRequired: true });
        return true;
      }
      const identifier = await dependencies.sessionRepository.create(account.address, account.role);
      writeSessionCookie(response, identifier, connectionIsSecure(request));
      sendJson(response, 200, { account, organization });
      return true;
    }

    if (request.method === "POST" && pathName === "/api/session/one-time-password") {
      const address = readPendingSignIn(request);
      if (!address) {
        throw new HttpError(401, "Sign in again");
      }
      const key = `sign-in:${address}`;
      const blocked = dependencies.signInGuard.rejectionMessage(key);
      if (blocked) {
        throw new HttpError(429, blocked);
      }
      const matches = await dependencies.accountRepository.oneTimePasswordMatches(address, textValue(context.body.code));
      if (!matches) {
        dependencies.signInGuard.recordFailure(key);
        throw new HttpError(401, "That authenticator code is wrong");
      }
      dependencies.signInGuard.recordSuccess(key);
      pendingSignIns.delete(readCookies(request).pending || "");
      const account = await dependencies.accountRepository.findAccount(address);
      if (!account) {
        throw new HttpError(401, "Sign in again");
      }
      const identifier = await dependencies.sessionRepository.create(account.address, account.role);
      writeSessionCookie(response, identifier, connectionIsSecure(request));
      sendJson(response, 200, { account, organization });
      return true;
    }

    if (request.method === "DELETE" && pathName === "/api/session") {
      const cookies = readCookies(request);
      await dependencies.sessionRepository.remove(cookies.session || "");
      writeSessionCookie(response, "", connectionIsSecure(request));
      sendJson(response, 200, { signedOut: true });
      return true;
    }

    if (!pathName.startsWith("/api/")) {
      return false;
    }

    if (request.method === "GET" && pathName === "/api/activity/summary") {
      requireAdministrator(context);
      const days = await dependencies.activityLogger.dailyCounts(14);
      sendJson(response, 200, {
        organization,
        days,
        queued: await dependencies.deliveryService.queuedCount(),
        mailboxCount: (await dependencies.accountRepository.listAccounts()).length,
        listeners: dependencies.listenerStatus,
        hosting: organization ? await hostingGuide(organization.domain) : null,
        publicPorts: await checkPublicPorts(
          await dependencies.serverName(),
          dependencies.listenerStatus.map((listener) => listener.port),
          dependencies.configuration.host
        )
      });
      return true;
    }

    if (request.method === "GET" && pathName === "/api/activity") {
      requireAdministrator(context);
      const events = await dependencies.activityLogger.query({
        protocol: url.searchParams.get("protocol") || "",
        result: url.searchParams.get("result") || "",
        search: url.searchParams.get("search") || "",
        limit: 200
      });
      sendJson(response, 200, { events });
      return true;
    }

    if (request.method === "GET" && pathName === "/api/mailboxes") {
      requireAdministrator(context);
      sendJson(response, 200, { mailboxes: await dependencies.accountRepository.listAccounts() });
      return true;
    }

    if (request.method === "POST" && pathName === "/api/mailboxes") {
      requireAdministrator(context);
      if (!organization) {
        throw new HttpError(409, "Set up the company domain first");
      }
      const account = await dependencies.accountRepository.createAccount({
        address: textValue(context.body.address),
        displayName: textValue(context.body.displayName),
        password: textValue(context.body.password),
        role: AccountRole.Member,
        domain: organization.domain
      });
      await dependencies.messageRepository.ensureMailbox(account.address);
      sendJson(response, 201, { account });
      return true;
    }

    if (request.method === "POST" && pathName === "/api/mailboxes/password") {
      const administrator = requireAdministrator(context);
      const updated = await dependencies.accountRepository.replacePassword(
        normalizeAddress(context.body.address),
        textValue(context.body.password)
      );
      await dependencies.sessionRepository.removeForAddress(updated.address);
      await dependencies.activityLogger.record({
        protocol: MailProtocol.Web,
        action: ActivityAction.Account,
        remoteAddress: request.socket.remoteAddress || "",
        mailboxAddress: updated.address,
        senderAddress: administrator.address,
        recipientAddresses: [],
        subject: "",
        byteCount: 0,
        result: ActivityResult.Accepted,
        detail: "password replaced"
      });
      sendJson(response, 200, { account: updated });
      return true;
    }

    if (request.method === "POST" && pathName === "/api/mailboxes/access") {
      const administrator = requireAdministrator(context);
      const address = normalizeAddress(context.body.address);
      const disabled = context.body.disabled === true;
      if (disabled && address === administrator.address) {
        throw new HttpError(400, "Another administrator must disable this mailbox");
      }
      const updated = await dependencies.accountRepository.setDisabled(address, disabled);
      if (updated.disabled) {
        await dependencies.sessionRepository.removeForAddress(updated.address);
      }
      await dependencies.activityLogger.record({
        protocol: MailProtocol.Web,
        action: ActivityAction.Account,
        remoteAddress: request.socket.remoteAddress || "",
        mailboxAddress: updated.address,
        senderAddress: administrator.address,
        recipientAddresses: [],
        subject: "",
        byteCount: 0,
        result: ActivityResult.Accepted,
        detail: updated.disabled ? "mailbox disabled" : "mailbox enabled"
      });
      sendJson(response, 200, { account: updated });
      return true;
    }

    if (request.method === "GET" && pathName === "/api/settings") {
      requireAdministrator(context);
      const settings = await dependencies.settingsRepository.read();
      sendJson(response, 200, { settings: dependencies.settingsRepository.present(settings) });
      return true;
    }

    if (request.method === "PUT" && pathName === "/api/settings") {
      requireAdministrator(context);
      const relay = context.body.relay;
      const relayRecord = relay && typeof relay === "object" ? (relay as Record<string, unknown>) : {};
      const settings = await dependencies.settingsRepository.update({
        publicHostname: textValue(context.body.publicHostname),
        relay: {
          enabled: relayRecord.enabled === true,
          host: textValue(relayRecord.host),
          port: Number(relayRecord.port),
          username: textValue(relayRecord.username),
          password: textValue(relayRecord.password),
          security: textValue(relayRecord.security) as RelaySecurity
        },
        secureWeb: context.body.secureWeb === undefined ? undefined : context.body.secureWeb === true
      });
      await dependencies.activityLogger.record({
        protocol: MailProtocol.Web,
        action: ActivityAction.Account,
        remoteAddress: request.socket.remoteAddress || "",
        mailboxAddress: context.account?.address || "",
        senderAddress: "",
        recipientAddresses: [],
        subject: "",
        byteCount: 0,
        result: ActivityResult.Accepted,
        detail: settings.relay.enabled ? "mail relay enabled" : "server settings saved"
      });
      sendJson(response, 200, { settings });
      return true;
    }

    if (request.method === "GET" && pathName === "/api/certificate") {
      requireAdministrator(context);
      sendJson(response, 200, { certificate: await dependencies.readCertificate() });
      return true;
    }

    if (request.method === "POST" && pathName === "/api/certificate") {
      requireAdministrator(context);
      const certificate = await dependencies.replaceCertificate(textValue(context.body.certificate), textValue(context.body.privateKey));
      await dependencies.activityLogger.record({
        protocol: MailProtocol.Web,
        action: ActivityAction.Account,
        remoteAddress: request.socket.remoteAddress || "",
        mailboxAddress: context.account?.address || "",
        senderAddress: "",
        recipientAddresses: [],
        subject: "",
        byteCount: 0,
        result: ActivityResult.Accepted,
        detail: "certificate replaced"
      });
      sendJson(response, 200, { certificate });
      return true;
    }

    const account = requireAccount(context);

    if (request.method === "POST" && pathName === "/api/account/password") {
      const current = await dependencies.accountRepository.verifyCredentials(account.address, textValue(context.body.currentPassword));
      if (!current) {
        throw new HttpError(401, "Current password is wrong");
      }
      const updated = await dependencies.accountRepository.replacePassword(account.address, textValue(context.body.password));
      await dependencies.sessionRepository.removeForAddress(updated.address);
      const identifier = await dependencies.sessionRepository.create(updated.address, updated.role);
      writeSessionCookie(response, identifier, connectionIsSecure(request));
      sendJson(response, 200, { account: updated });
      return true;
    }

    if (request.method === "POST" && pathName === "/api/account/one-time-password") {
      const secret = createOneTimePasswordSecret();
      await dependencies.accountRepository.storePendingOneTimePassword(account.address, secret);
      const uri = oneTimePasswordUri({
        issuer: dependencies.configuration.productName,
        accountName: account.address,
        secret
      });
      sendJson(response, 200, { secret, image: authenticatorImage(uri) });
      return true;
    }

    if (request.method === "POST" && pathName === "/api/account/one-time-password/confirm") {
      const updated = await dependencies.accountRepository.confirmOneTimePassword(account.address, textValue(context.body.code));
      if (!updated) {
        throw new HttpError(401, "That authenticator code is wrong");
      }
      sendJson(response, 200, { account: updated });
      return true;
    }

    if (request.method === "POST" && pathName === "/api/account/one-time-password/remove") {
      const current = await dependencies.accountRepository.verifyCredentials(account.address, textValue(context.body.password));
      const matches = await dependencies.accountRepository.oneTimePasswordMatches(account.address, textValue(context.body.code));
      if (!current || !matches) {
        throw new HttpError(401, "Password or authenticator code is wrong");
      }
      const updated = await dependencies.accountRepository.clearOneTimePassword(account.address);
      sendJson(response, 200, { account: updated });
      return true;
    }
    const folderMatch = /^\/api\/folders\/([^/]+)\/messages(?:\/([^/]+))?(?:\/attachments\/(\d+))?$/.exec(pathName);

    if (request.method === "GET" && pathName === "/api/folders") {
      const folders = await dependencies.messageRepository.listFolders(account.address);
      const counts = [];
      for (const folder of folders) {
        const messages = await dependencies.messageRepository.listMessages(account.address, folder.storageName);
        counts.push({
          ...folder,
          messageCount: messages.length,
          unseenCount: messages.filter((message) => !message.seen).length
        });
      }
      sendJson(response, 200, { folders: counts });
      return true;
    }

    if (request.method === "POST" && pathName === "/api/messages") {
      const toAddresses = parseAddressList(context.body.to);
      const copyAddresses = parseAddressList(context.body.copy);
      const blindCopyAddresses = parseAddressList(context.body.blindCopy);
      assertAddressList(toAddresses, "To");
      for (const address of [...copyAddresses, ...blindCopyAddresses]) {
        if (!isValidAddress(address)) {
          throw new HttpError(400, `Invalid address: ${address}`);
        }
      }
      const domain = organization?.domain || account.address.split("@")[1];
      const rawBuffer = createRawMessage({
        fromName: account.displayName,
        fromAddress: account.address,
        toAddresses,
        copyAddresses,
        subject: textValue(context.body.subject),
        text: textValue(context.body.text),
        html: sanitizeMessageHtml(textValue(context.body.html)),
        attachments: readOutboundAttachments(context.body.attachments, dependencies.configuration.maximumMessageBytes),
        messageIdentifierHeader: createMessageIdentifier(domain),
        inReplyTo: textValue(context.body.inReplyTo),
        date: new Date()
      });
      const result = await dependencies.deliveryService.deliver({
        fromAddress: account.address,
        recipientAddresses: [...toAddresses, ...copyAddresses, ...blindCopyAddresses],
        rawBuffer,
        authenticatedAddress: account.address,
        remoteAddress: request.socket.remoteAddress || "",
        protocol: MailProtocol.Web
      });
      sendJson(response, 201, result);
      return true;
    }

    if (request.method === "POST" && pathName === "/api/drafts") {
      const domain = organization?.domain || account.address.split("@")[1];
      const toAddresses = parseAddressList(context.body.to).filter((address) => isValidAddress(address));
      const rawBuffer = createRawMessage({
        fromName: account.displayName,
        fromAddress: account.address,
        toAddresses: toAddresses.length ? toAddresses : [account.address],
        copyAddresses: [],
        subject: textValue(context.body.subject) || "(no subject)",
        text: textValue(context.body.text),
        html: sanitizeMessageHtml(textValue(context.body.html)),
        attachments: readOutboundAttachments(context.body.attachments, dependencies.configuration.maximumMessageBytes),
        messageIdentifierHeader: createMessageIdentifier(domain),
        inReplyTo: "",
        date: new Date()
      });
      const parsedDraft = {
        fromName: account.displayName,
        fromAddress: account.address,
        toAddresses,
        copyAddresses: [] as string[],
        subject: textValue(context.body.subject) || "(no subject)",
        text: textValue(context.body.text),
        html: sanitizeMessageHtml(textValue(context.body.html)),
        date: new Date().toISOString(),
        messageIdentifierHeader: createMessageIdentifier(domain),
        inReplyTo: "",
        seen: true,
        answered: false,
        flagged: false,
        deleted: false,
        draft: true,
        rawEncoded: rawBuffer.toString("base64"),
        rawSize: rawBuffer.length,
        attachments: parseRawMessage(rawBuffer).attachments
      };
      const record = await dependencies.messageRepository.appendMessage(account.address, "drafts", parsedDraft);
      sendJson(response, 201, { message: summary(record) });
      return true;
    }

    if (!folderMatch) {
      throw new HttpError(404, "Not found");
    }
    const folderName = decodeURIComponent(folderMatch[1]);
    const identifier = folderMatch[2] || "";
    const attachmentIndex = folderMatch[3];

    if (request.method === "GET" && !identifier) {
      const search = (url.searchParams.get("search") || "").trim().toLowerCase();
      const messages = await dependencies.messageRepository.listMessages(account.address, folderName);
      const visible = messages
        .filter((message) => {
          if (!search) {
            return true;
          }
          return `${message.fromName} ${message.fromAddress} ${message.subject} ${message.text}`.toLowerCase().includes(search);
        })
        .reverse()
        .map(summary);
      sendJson(response, 200, { messages: visible });
      return true;
    }

    if (request.method === "GET" && identifier && attachmentIndex !== undefined) {
      const message = await dependencies.messageRepository.readMessage(account.address, folderName, identifier);
      const attachment = message.attachments[Number(attachmentIndex)];
      if (!attachment) {
        throw new HttpError(404, "Attachment not found");
      }
      const content = Buffer.from(attachment.contentEncoded || "", "base64");
      response.writeHead(200, {
        "Content-Type": attachment.contentType || "application/octet-stream",
        "Content-Length": content.length,
        "Content-Disposition": `attachment; filename="${attachment.fileName.replace(/"/g, "")}"`,
        "X-Content-Type-Options": "nosniff"
      });
      response.end(content);
      return true;
    }

    if (request.method === "GET" && identifier) {
      const message = await dependencies.messageRepository.readMessage(account.address, folderName, identifier);
      if (!message.seen) {
        await dependencies.messageRepository.updateMessage(account.address, folderName, identifier, { seen: true });
        message.seen = true;
      }
      sendJson(response, 200, {
        message: {
          ...summary(message),
          text: message.text || "",
          html: message.html || "",
          messageIdentifierHeader: message.messageIdentifierHeader || "",
          attachments: (message.attachments || []).map((attachment, index) => ({
            index,
            fileName: attachment.fileName,
            contentType: attachment.contentType,
            size: attachment.size || 0,
            contentIdentifier: attachment.contentIdentifier || ""
          }))
        }
      });
      return true;
    }

    if (request.method === "PATCH" && identifier) {
      const changes: { seen?: boolean; flagged?: boolean } = {};
      if (typeof context.body.seen === "boolean") {
        changes.seen = context.body.seen;
      }
      if (typeof context.body.flagged === "boolean") {
        changes.flagged = context.body.flagged;
      }
      const message = await dependencies.messageRepository.updateMessage(account.address, folderName, identifier, changes);
      sendJson(response, 200, { message: summary(message) });
      return true;
    }

    if (request.method === "DELETE" && identifier) {
      if (folderName.toLowerCase() === "trash") {
        await dependencies.messageRepository.removeMessages(account.address, folderName, [identifier]);
      } else {
        await dependencies.messageRepository.moveMessage(account.address, folderName, "trash", identifier);
      }
      sendJson(response, 200, { removed: true });
      return true;
    }

    throw new HttpError(404, "Not found");
  }

  const handler = async (request: http.IncomingMessage, response: http.ServerResponse) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    if (connectionIsSecure(request)) {
      response.setHeader("Strict-Transport-Security", "max-age=15552000");
    }
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-src 'self'"
    );
    try {
      const host = request.headers.host || `127.0.0.1:${dependencies.configuration.webPort}`;
      const url = new URL(request.url || "/", `http://${host}`);
      if (request.method !== "GET" && request.method !== "HEAD") {
        const origin = request.headers.origin;
        if (origin) {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            throw new HttpError(403, "Origin is not allowed");
          }
        }
      }
      const cookies = readCookies(request);
      const session = await dependencies.sessionRepository.read(cookies.session || "");
      const found = session ? await dependencies.accountRepository.findAccount(session.address) : null;
      const account = found && !found.disabled ? found : null;
      const body =
        request.method === "GET" || request.method === "HEAD" || request.method === "DELETE"
          ? {}
          : await readJsonBody(request);
      const handled = await route({ request, response, url, account, body });
      if (handled) {
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        throw new HttpError(404, "Not found");
      }
      const filePath = await resolvePublicFile(url.pathname);
      if (!filePath) {
        throw new HttpError(404, "Not found");
      }
      const extension = path.extname(filePath);
      response.writeHead(200, {
        "Content-Type": contentTypes[extension] || "application/octet-stream",
        "Cache-Control": "no-cache"
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(filePath).pipe(response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const statusCode = error instanceof HttpError ? error.statusCode : (error as { statusCode?: number }).statusCode || 500;
      if (statusCode >= 500) {
        console.error(error);
      }
      sendJson(response, statusCode, { error: statusCode >= 500 ? "Something went wrong" : (error as Error).message });
    }
  };

  const server = dependencies.configuration.secureWeb
    ? https.createServer(secureOptions(dependencies.certificate), handler)
    : http.createServer(handler);

  return server;
}

export function startWebServer(server: http.Server | https.Server, port: number, host: string): Promise<number> {
  return listen(server, port, host);
}
