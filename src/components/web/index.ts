import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import tls from "node:tls";
import { maximumConfigurableMessageBytes } from "../configuration/constants/serverDefaults.js";
import { contentTypes } from "./constants/contentTypes.js";
import type { Configuration } from "../configuration/index.js";
import { HttpError } from "../httpError/index.js";
import { AccountRole } from "../account/enums/accountRole.js";
import { ActivityAction } from "../activity/enums/activityAction.js";
import { ActivityResult } from "../activity/enums/activityResult.js";
import { MailProtocol } from "../protocol/enums/mailProtocol.js";
import { RelaySecurity } from "../settings/enums/relaySecurity.js";
import { MailFolderName } from "../message/enums/mailFolderName.js";
import { ApiEndpoint, matchApiEndpoint } from "./enums/apiEndpoint.js";
import type { MessageRecord } from "../message/interfaces/mailTypes.js";
import type { MailboxEvents } from "../mailboxEvents/interfaces/mailboxEvents.js";
import type { PublicAccount } from "../account/interfaces/accountRecord.js";
import type { PendingSignIn, ServerRequest } from "./interfaces/serverRequest.js";
import { assertAddressList, isValidAddress, normalizeAddress, parseAddressList } from "../text/index.js";
import type { DeliveryService } from "../delivery/interfaces/delivery.js";
import { checkPublicPorts } from "../publicPort/index.js";
import type { OrganizationRecord } from "../organization/interfaces/organizationRecord.js";
import { openDomainKey } from "../domainKey/index.js";
import { consoleAllowsVisitor } from "./utils/consoleVisitor.js";
import { createDnsGuide, formatDnsGuideForTerminal } from "./utils/dnsGuide.js";
import { AddressRouteRepository } from "../addressRoute/index.js";
import {
  createStorageBackup,
  deleteStorageBackup,
  endRestore,
  isRestoreInProgress,
  listStorageBackups,
  restoreStorageBackup,
  tryBeginRestore
} from "../backup/index.js";
import { displayedImageType } from "./utils/displayedImageType.js";
import { createMessageIdentifier, createRawMessage, parseRawMessage, sanitizeMessageHtml, type OutboundAttachment } from "../mime/index.js";
import { createSnippet } from "../mime/index.js";
import { listen } from "../protocol/utils/listen.js";
import { secureOptions } from "../protocol/utils/transportSecurity.js";
import type { AccountRepository } from "../account/interfaces/accountRepository.js";
import type { ActivityLogger } from "../activity/interfaces/activityLogger.js";
import type { MessageRepository } from "../message/interfaces/messageRepository.js";
import type { OrganizationRepository } from "../organization/interfaces/organizationRepository.js";
import type { SessionRepository } from "../session/interfaces/sessionRepository.js";
import type { SettingsRepository } from "../settings/interfaces/settings.js";
import type { CertificateDescription, ServerCertificate } from "../certificate/index.js";
import type { SignInGuard } from "../signIn/interfaces/signInGuard.js";
import type { ListenerStatus } from "./interfaces/listenerStatus.js";
import { projectDirectoryFrom } from "../configuration/utils/projectDirectory.js";
import { messageSendError } from "./utils/messageSendError.js";
import { authenticatorImage, createOneTimePasswordSecret, oneTimePasswordUri } from "../oneTimePassword/index.js";
export type { ListenerStatus };

const frontendExtensions = new Set([".html", ".css", ".js", ".svg"]);

function frontendDirectories(): string[] {
  const projectDirectory = projectDirectoryFrom(import.meta.url);
  return [path.join(projectDirectory, "dist", "web"), path.join(projectDirectory, "src", "web")];
}

function isConsoleApplicationPath(requestPath: string): boolean {
  return (
    requestPath === "/account" ||
    requestPath === "/overview" ||
    requestPath.startsWith("/overview/") ||
    requestPath === "/mailbox" ||
    requestPath.startsWith("/mailbox/") ||
    requestPath.startsWith("/admin/")
  );
}

export function isResolvedPathInsideRoot(candidate: string, resolvedRoot: string): boolean {
  return candidate === resolvedRoot || candidate.startsWith(`${resolvedRoot}${path.sep}`);
}

async function resolvePublicFile(requestPath: string): Promise<string | null> {
  const relativePath = requestPath === "/" || isConsoleApplicationPath(requestPath) ? "index.html" : requestPath.replace(/^\/+/, "");
  for (const root of frontendDirectories()) {
    const resolvedRoot = path.resolve(root);
    const candidate = path.resolve(resolvedRoot, relativePath);
    if (!isResolvedPathInsideRoot(candidate, resolvedRoot)) {
      return null;
    }
    if (!frontendExtensions.has(path.extname(candidate))) {
      continue;
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
    if (size > maximumConfigurableMessageBytes * 2) {
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

function attachmentDownloadHeaders(fileName: string, contentType: string, length: number): Record<string, string | number> {
  const cleanedName = fileName.replace(/[\r\n"]/g, "").slice(0, 120) || "attachment";
  const imageType = displayedImageType(contentType, cleanedName);
  if (imageType) {
    return {
      "Content-Type": imageType,
      "Content-Length": length,
      "Content-Disposition": `inline; filename="${cleanedName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    };
  }
  return {
    "Content-Type": "application/octet-stream",
    "Content-Length": length,
    "Content-Disposition": `attachment; filename="${cleanedName}"`,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
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

function scheduleProcessRestart(response: http.ServerResponse, requestProcessRestart?: () => void): void {
  if (!requestProcessRestart) {
    return;
  }
  const restart = () => {
    setImmediate(() => {
      requestProcessRestart();
    });
  };
  if (response.writableFinished) {
    restart();
    return;
  }
  response.once("finish", restart);
}

function textValue(value: unknown): string {
  return String(value ?? "");
}

function limitsFromBody(value: unknown): {
  maximumMessageBytes?: number;
  mailboxQuotaBytes?: number;
  maximumUnauthenticatedConnections?: number;
  maximumUnauthenticatedMessages?: number;
} | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const limits: {
    maximumMessageBytes?: number;
    mailboxQuotaBytes?: number;
    maximumUnauthenticatedConnections?: number;
    maximumUnauthenticatedMessages?: number;
  } = {};
  for (const name of ["maximumMessageBytes", "mailboxQuotaBytes", "maximumUnauthenticatedConnections", "maximumUnauthenticatedMessages"] as const) {
    if (record[name] === undefined || record[name] === "") {
      continue;
    }
    limits[name] = Number(record[name]);
  }
  return Object.keys(limits).length ? limits : undefined;
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
    snippet: record.snippet || createSnippet(record.text || ""),
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

const companyApiPrefixes = [ApiEndpoint.Activity, ApiEndpoint.FailedEmail, ApiEndpoint.Mailboxes, ApiEndpoint.AddressRoutes, ApiEndpoint.Settings, ApiEndpoint.Certificate, ApiEndpoint.Backup];

function companyApiPath(pathName: string): boolean {
  return companyApiPrefixes.some((prefix) => pathName === prefix || pathName.startsWith(`${prefix}/`));
}

function personalApiPath(pathName: string): boolean {
  return (
    pathName === ApiEndpoint.MailboxEvents ||
    pathName === ApiEndpoint.MailClientSettings ||
    pathName === ApiEndpoint.Folders ||
    pathName === ApiEndpoint.Messages ||
    pathName === ApiEndpoint.Drafts ||
    pathName.startsWith(`${ApiEndpoint.Folders}/`) ||
    pathName.startsWith("/api/account/")
  );
}

export function createWebServer(dependencies: {
  configuration: Configuration;
  accountRepository: AccountRepository;
  organizationRepository: OrganizationRepository;
  messageRepository: MessageRepository;
  mailboxEvents: MailboxEvents;
  sessionRepository: SessionRepository;
  activityLogger: ActivityLogger;
  deliveryService: DeliveryService;
  signInGuard: SignInGuard;
  listenerStatus: ListenerStatus[];
  certificate: ServerCertificate;
  serverName(): Promise<string>;
  settingsRepository: SettingsRepository;
  readCertificate(): Promise<CertificateDescription>;
  replaceCertificate(certificatePem: string, privateKeyPem: string, intermediateCertificatesPem?: string): Promise<CertificateDescription>;
  requestProcessRestart?: () => void;
}): http.Server | https.Server {
  const addressRouteRepository = new AddressRouteRepository(dependencies.configuration.storageDirectory);
  async function mailClientSettings(company: OrganizationRecord) {
    const hostname = (await dependencies.serverName()) || company.domain;
    const incoming = dependencies.listenerStatus.find((item) => item.name === "IMAP" && item.security === "TLS");
    const outgoing = dependencies.listenerStatus.find((item) => item.name === "SMTP" && item.security === "STARTTLS");
    return {
      incomingHost: hostname,
      incomingPort: incoming?.port || dependencies.configuration.imapSecurePort,
      incomingSecurity: "TLS",
      outgoingHost: hostname,
      outgoingPort: outgoing?.port || dependencies.configuration.smtpSubmissionPort,
      outgoingSecurity: "STARTTLS"
    };
  }

  async function hostingGuide(company: OrganizationRecord) {
    const hostname = (await dependencies.serverName()) || company.domain;
    const domainKey = await openDomainKey(dependencies.configuration.storageDirectory);
    const dnsGuide = createDnsGuide(company.domain, hostname, company.publicAddress, domainKey.recordValue, company.administratorAddress);
    return {
      publicHostname: hostname,
      domain: company.domain,
      secureWeb: dependencies.configuration.secureWeb,
      dns: dnsGuide.records,
      zoneFile: dnsGuide.zoneFile,
      clients: await mailClientSettings(company)
    };
  }

  async function route(context: ServerRequest): Promise<boolean> {
    const { request, response, url } = context;
    const pathName = url.pathname;
    const organization = await dependencies.organizationRepository.read();

    if (request.method === "GET" && pathName === ApiEndpoint.Bootstrap) {
      const isAdministrator = context.account?.role === AccountRole.Administrator;
      const publicOrganization = organization
        ? isAdministrator
          ? organization
          : { domain: organization.domain, displayName: organization.displayName }
        : null;
      sendJson(response, 200, {
        productName: "Open Mail Server",
        needsSetup: !organization,
        configuredDomain: dependencies.configuration.configuredDomain,
        organization: publicOrganization,
        account: context.account,
        listeners: isAdministrator ? dependencies.listenerStatus : [],
        hosting: organization && isAdministrator ? await hostingGuide(organization) : null
      });
      return true;
    }

    if (request.method === "POST" && pathName === ApiEndpoint.Setup) {
      if (organization || (await dependencies.accountRepository.hasAccounts())) {
        throw new HttpError(409, "This server is already set up");
      }
      const domain = textValue(context.body.domain).trim().toLowerCase();
      const created = await dependencies.organizationRepository.create({
        domain,
        displayName: textValue(context.body.organizationName),
        requiredDomain: dependencies.configuration.configuredDomain,
        publicAddress: textValue(context.body.publicAddress),
        administratorAddress: textValue(context.body.address)
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
        try {
          const hosting = await hostingGuide(created);
          console.log("");
          console.log(formatDnsGuideForTerminal(created.domain, hosting.zoneFile));
          console.log("");
        } catch (error) {
          console.error((error as Error).message);
        }
        sendJson(response, 201, { organization: created, account });
      } catch (error) {
        await dependencies.organizationRepository.remove();
        throw error;
      }
      return true;
    }

    if (request.method === "POST" && pathName === ApiEndpoint.Session) {
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

    if (request.method === "POST" && pathName === ApiEndpoint.SessionOneTimePassword) {
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

    if (request.method === "DELETE" && pathName === ApiEndpoint.Session) {
      const cookies = readCookies(request);
      await dependencies.sessionRepository.remove(cookies.session || "");
      writeSessionCookie(response, "", connectionIsSecure(request));
      sendJson(response, 200, { signedOut: true });
      return true;
    }

    if (!pathName.startsWith(`${ApiEndpoint.Root}/`)) {
      return false;
    }

    if (companyApiPath(pathName)) {
      requireAdministrator(context);
    }

    if (request.method === "GET" && pathName === ApiEndpoint.ActivitySummary) {
      requireAdministrator(context);
      const days = await dependencies.activityLogger.dailyCounts(14);
      const queued = await dependencies.deliveryService.queuedCount();
      const attentionEvents = await dependencies.activityLogger.attentionEvents();
      const publicPorts = await checkPublicPorts(
        organization?.publicAddress || "",
        dependencies.listenerStatus.map((listener) => listener.port),
        dependencies.configuration.host
      );
      sendJson(response, 200, {
        organization,
        days,
        queued,
        attention: attentionEvents.length + queued,
        mailboxCount: (await dependencies.accountRepository.listAccounts()).length,
        listeners: dependencies.listenerStatus,
        hosting: organization ? await hostingGuide(organization) : null,
        publicPorts
      });
      return true;
    }

    if (request.method === "GET" && pathName === ApiEndpoint.ActivityAttention) {
      requireAdministrator(context);
      sendJson(response, 200, {
        events: await dependencies.activityLogger.attentionEvents(),
        messages: await dependencies.deliveryService.listFailedEmail()
      });
      return true;
    }

    if (request.method === "POST" && pathName === ApiEndpoint.ActivityAttentionReset) {
      requireAdministrator(context);
      const acknowledgedAt = await dependencies.activityLogger.acknowledgeAttention();
      sendJson(response, 200, { acknowledgedAt });
      return true;
    }

    if (request.method === "GET" && pathName === ApiEndpoint.Activity) {
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

    if (request.method === "GET" && pathName === ApiEndpoint.FailedEmail) {
      requireAdministrator(context);
      sendJson(response, 200, { messages: await dependencies.deliveryService.listFailedEmail() });
      return true;
    }

    if (request.method === "POST" && pathName === ApiEndpoint.FailedEmailResend) {
      requireAdministrator(context);
      if (!Array.isArray(context.body.identifiers)) {
        throw new HttpError(400, "Choose the failed email to resend");
      }
      const identifiers = context.body.identifiers.map((value) => textValue(value).trim()).filter(Boolean);
      sendJson(response, 200, await dependencies.deliveryService.resendFailedEmail(identifiers));
      return true;
    }

    if (request.method === "GET" && pathName === ApiEndpoint.Mailboxes) {
      requireAdministrator(context);
      sendJson(response, 200, { mailboxes: await dependencies.accountRepository.listAccounts() });
      return true;
    }

    if (request.method === "POST" && pathName === ApiEndpoint.Mailboxes) {
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

    if (request.method === "POST" && pathName === ApiEndpoint.MailboxPassword) {
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

    if (request.method === "POST" && pathName === ApiEndpoint.MailboxAccess) {
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

    if (request.method === "GET" && pathName === ApiEndpoint.Settings) {
      requireAdministrator(context);
      const settings = await dependencies.settingsRepository.read();
      sendJson(response, 200, { settings: dependencies.settingsRepository.present(settings) });
      return true;
    }

    if (request.method === "PUT" && pathName === ApiEndpoint.Settings) {
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
        secureWeb: context.body.secureWeb === undefined ? undefined : context.body.secureWeb === true,
        limits: limitsFromBody(context.body.limits)
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

    if (pathName === ApiEndpoint.AddressRoutes && request.method === "GET") {
      requireAdministrator(context);
      if (!organization) {
        throw new HttpError(409, "Create the company first");
      }
      sendJson(response, 200, { companyDomain: organization.domain, routes: await addressRouteRepository.read() });
      return true;
    }

    if (pathName.startsWith(ApiEndpoint.AddressRoutes)) {
      requireAdministrator(context);
      if (!organization) {
        throw new HttpError(409, "Create the company first");
      }
      if (request.method !== "POST") {
        throw new HttpError(404, "Not found");
      }
      const removing = context.body.remove === true;
      if (pathName === ApiEndpoint.AddressRouteAliases) {
        const address = normalizeAddress(textValue(context.body.address));
        const mailboxAddress = normalizeAddress(textValue(context.body.mailboxAddress));
        if (!removing && (await dependencies.accountRepository.exists(address))) {
          throw new HttpError(400, `${address} is already a mailbox`);
        }
        if (!removing && !(await dependencies.accountRepository.exists(mailboxAddress))) {
          throw new HttpError(400, `Mailbox ${mailboxAddress} does not exist`);
        }
        const routes = removing
          ? await addressRouteRepository.removeAlias(textValue(context.body.address))
          : await addressRouteRepository.addAlias({ address, mailboxAddress }, organization.domain);
        sendJson(response, removing ? 200 : 201, { routes });
        return true;
      }
      if (pathName === ApiEndpoint.AddressRouteLists) {
        const mailboxAddresses = String(textValue(context.body.mailboxAddresses))
          .split(/[,\s]+/)
          .map((address) => normalizeAddress(address))
          .filter(Boolean);
        if (!removing) {
          for (const mailboxAddress of mailboxAddresses) {
            if (!(await dependencies.accountRepository.exists(mailboxAddress))) {
              throw new HttpError(400, `Mailbox ${mailboxAddress} does not exist`);
            }
          }
        }
        const routes = removing
          ? await addressRouteRepository.removeList(textValue(context.body.address))
          : await addressRouteRepository.addList({ address: textValue(context.body.address), mailboxAddresses }, organization.domain);
        sendJson(response, removing ? 200 : 201, { routes });
        return true;
      }
      if (pathName === ApiEndpoint.AddressRouteDomains) {
        const routes = removing
          ? await addressRouteRepository.removeDomain(textValue(context.body.domain))
          : await addressRouteRepository.addDomain(textValue(context.body.domain), organization.domain);
        sendJson(response, removing ? 200 : 201, { routes });
        return true;
      }
      if (pathName === ApiEndpoint.AddressRouteCatchAll) {
        const mailboxAddress = normalizeAddress(textValue(context.body.mailboxAddress));
        if (!removing && !(await dependencies.accountRepository.exists(mailboxAddress))) {
          throw new HttpError(400, `Mailbox ${mailboxAddress} does not exist`);
        }
        const routes = removing
          ? await addressRouteRepository.removeCatchAll(textValue(context.body.domain))
          : await addressRouteRepository.addCatchAll({ domain: textValue(context.body.domain), mailboxAddress }, organization.domain);
        sendJson(response, removing ? 200 : 201, { routes });
        return true;
      }
      if (pathName === ApiEndpoint.AddressRouteBlocked) {
        const routes = removing
          ? await addressRouteRepository.removeBlockedSender(textValue(context.body.value))
          : await addressRouteRepository.addBlockedSender(textValue(context.body.value));
        sendJson(response, removing ? 200 : 201, { routes });
        return true;
      }
      throw new HttpError(404, "Not found");
    }

    if (request.method === "GET" && pathName === ApiEndpoint.Backup) {
      requireAdministrator(context);
      sendJson(response, 200, { backups: await listStorageBackups(dependencies.configuration.storageDirectory) });
      return true;
    }

    if (request.method === "POST" && pathName === ApiEndpoint.Backup) {
      requireAdministrator(context);
      if (isRestoreInProgress()) {
        throw new HttpError(409, "A restore is already in progress");
      }
      const backupDirectory = await createStorageBackup(dependencies.configuration.storageDirectory);
      sendJson(response, 201, { backupName: path.basename(backupDirectory) });
      return true;
    }

    if (request.method === "DELETE" && pathName === ApiEndpoint.Backup) {
      requireAdministrator(context);
      if (isRestoreInProgress()) {
        throw new HttpError(409, "A restore is already in progress");
      }
      const backupName = textValue(context.body.backupName).trim();
      try {
        await deleteStorageBackup(dependencies.configuration.storageDirectory, backupName);
      } catch (error) {
        if ((error as Error).message === "Choose a backup from the list") {
          throw new HttpError(400, "Choose a backup from the list");
        }
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new HttpError(404, "That backup was not found");
        }
        throw error;
      }
      sendJson(response, 200, { deleted: true, backupName });
      return true;
    }

    if (request.method === "POST" && pathName === ApiEndpoint.BackupRestore) {
      requireAdministrator(context);
      if (!tryBeginRestore()) {
        throw new HttpError(409, "A restore is already in progress");
      }
      const backupName = textValue(context.body.backupName).trim();
      try {
        try {
          await restoreStorageBackup(dependencies.configuration.storageDirectory, backupName);
        } catch (error) {
          if ((error as Error).message === "Choose a backup from the list") {
            throw new HttpError(400, "Choose a backup from the list");
          }
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new HttpError(404, "That backup was not found");
          }
          throw error;
        }
        sendJson(response, 200, { restored: true, backupName, restarting: true });
        scheduleProcessRestart(response, dependencies.requestProcessRestart);
        return true;
      } finally {
        endRestore();
      }
    }

    if (request.method === "GET" && pathName === ApiEndpoint.Certificate) {
      requireAdministrator(context);
      sendJson(response, 200, { certificate: await dependencies.readCertificate() });
      return true;
    }

    if (request.method === "POST" && pathName === ApiEndpoint.Certificate) {
      requireAdministrator(context);
      const certificate = await dependencies.replaceCertificate(
        textValue(context.body.certificate),
        textValue(context.body.privateKey),
        textValue(context.body.intermediateCertificates)
      );
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

    if (!personalApiPath(pathName)) {
      throw new HttpError(404, "Not found");
    }

    const account = requireAccount(context);

    if (request.method === "GET" && pathName === ApiEndpoint.MailClientSettings) {
      if (!organization) {
        throw new HttpError(404, "This server is not set up");
      }
      sendJson(response, 200, { clients: await mailClientSettings(organization) });
      return true;
    }

    if (request.method === "GET" && pathName === ApiEndpoint.MailboxEvents) {
      const stopListening = dependencies.mailboxEvents.subscribe((change) => {
        if (change.address !== account.address || response.writableEnded || response.destroyed) {
          return;
        }
        response.write(`data: ${JSON.stringify({ folderName: change.folderStorageName })}\n\n`);
      });
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });
      response.write(": connected\n\n");
      const heartbeat = setInterval(() => {
        if (response.writableEnded || response.destroyed) {
          clearInterval(heartbeat);
          return;
        }
        response.write(":\n\n");
      }, 20000);
      heartbeat.unref();
      request.on("close", () => {
        clearInterval(heartbeat);
        stopListening();
      });
      return true;
    }

    if (request.method === "POST" && pathName === ApiEndpoint.AccountPassword) {
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

    if (request.method === "POST" && pathName === ApiEndpoint.AccountOneTimePassword) {
      const secret = createOneTimePasswordSecret();
      await dependencies.accountRepository.storePendingOneTimePassword(account.address, secret);
      const uri = oneTimePasswordUri({
        issuer: "Open Mail Server",
        accountName: account.address,
        secret
      });
      sendJson(response, 200, { secret, image: authenticatorImage(uri) });
      return true;
    }

    if (request.method === "POST" && pathName === ApiEndpoint.AccountOneTimePasswordConfirm) {
      const updated = await dependencies.accountRepository.confirmOneTimePassword(account.address, textValue(context.body.code));
      if (!updated) {
        throw new HttpError(401, "That authenticator code is wrong");
      }
      sendJson(response, 200, { account: updated });
      return true;
    }

    if (request.method === "POST" && pathName === ApiEndpoint.AccountOneTimePasswordRemove) {
      const current = await dependencies.accountRepository.verifyCredentials(account.address, textValue(context.body.password));
      const matches = await dependencies.accountRepository.oneTimePasswordMatches(account.address, textValue(context.body.code));
      if (!current || !matches) {
        throw new HttpError(401, "Password or authenticator code is wrong");
      }
      const updated = await dependencies.accountRepository.clearOneTimePassword(account.address);
      sendJson(response, 200, { account: updated });
      return true;
    }
    const folderMatch =
      matchApiEndpoint(pathName, ApiEndpoint.FolderAttachment) ||
      matchApiEndpoint(pathName, ApiEndpoint.FolderMessage) ||
      matchApiEndpoint(pathName, ApiEndpoint.FolderMessages);

    if (request.method === "GET" && pathName === ApiEndpoint.Folders) {
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

    if (request.method === "POST" && pathName === ApiEndpoint.Messages) {
      try {
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
          attachments: readOutboundAttachments(context.body.attachments, (await dependencies.settingsRepository.read()).limits.maximumMessageBytes),
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
          protocol: MailProtocol.Web,
          acceptExternalImmediately: true,
          bounceMissingMailboxes: true
        });
        sendJson(response, 201, result);
      } catch (error) {
        const friendly = messageSendError(error);
        if (!friendly) {
          throw error;
        }
        throw new HttpError(friendly.statusCode, friendly.message);
      }
      return true;
    }

    if (request.method === "POST" && pathName === ApiEndpoint.Drafts) {
      const domain = organization?.domain || account.address.split("@")[1];
      const toAddresses = parseAddressList(context.body.to).filter((address) => isValidAddress(address));
      const copyAddresses = parseAddressList(context.body.copy).filter((address) => isValidAddress(address));
      const rawBuffer = createRawMessage({
        fromName: account.displayName,
        fromAddress: account.address,
        toAddresses: toAddresses.length ? toAddresses : [account.address],
        copyAddresses,
        subject: textValue(context.body.subject) || "(no subject)",
        text: textValue(context.body.text),
        html: sanitizeMessageHtml(textValue(context.body.html)),
        attachments: readOutboundAttachments(context.body.attachments, (await dependencies.settingsRepository.read()).limits.maximumMessageBytes),
        messageIdentifierHeader: createMessageIdentifier(domain),
        inReplyTo: "",
        date: new Date()
      });
      const parsedDraft = {
        fromName: account.displayName,
        fromAddress: account.address,
        toAddresses,
        copyAddresses,
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
      const record = await dependencies.messageRepository.appendMessage(account.address, MailFolderName.Drafts, parsedDraft);
      sendJson(response, 201, { message: summary(record) });
      return true;
    }

    if (!folderMatch) {
      throw new HttpError(404, "Not found");
    }
    const folderName = folderMatch.folder || "";
    const identifier = folderMatch.message || "";
    const attachmentIndex = folderMatch.attachment;

    if (request.method === "GET" && !identifier) {
      const search = (url.searchParams.get("search") || "").trim().toLowerCase();
      const messages = await dependencies.messageRepository.listMessages(account.address, folderName);
      const visible = [];
      for (const message of [...messages].reverse()) {
        const header = `${message.fromName} ${message.fromAddress} ${message.subject} ${message.snippet || ""}`.toLowerCase();
        if (!search || header.includes(search)) {
          visible.push(summary(message));
          continue;
        }
        const stored = await dependencies.messageRepository.readMessage(account.address, folderName, message.identifier);
        if (`${stored.text}`.toLowerCase().includes(search)) {
          visible.push(summary(stored));
        }
      }
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
      response.writeHead(200, attachmentDownloadHeaders(attachment.fileName, attachment.contentType || "", content.length));
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
          html: sanitizeMessageHtml(message.html || ""),
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
      if (folderName.toLowerCase() === MailFolderName.Trash) {
        await dependencies.messageRepository.removeMessages(account.address, folderName, [identifier]);
      } else {
        await dependencies.messageRepository.moveMessage(account.address, folderName, MailFolderName.Trash, identifier);
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
      "default-src 'self'; connect-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'self'; frame-ancestors 'none'"
    );
    try {
      const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
      if (request.method === "GET" && requestUrl.pathname === "/health") {
        const failed = dependencies.listenerStatus.filter((listener) => !listener.started);
        sendJson(response, failed.length ? 503 : 200, { ok: failed.length === 0 });
        return;
      }
      const companyAccountExists = await dependencies.accountRepository.hasAccounts();
      if (!consoleAllowsVisitor(request.socket.remoteAddress || "", companyAccountExists)) {
        throw new HttpError(403, "Create the company from this machine before opening the console from another computer");
      }
      const host = request.headers.host || `127.0.0.1:${dependencies.configuration.webPort}`;
      const url = new URL(request.url || "/", `http://${host}`);
      if (request.method !== "GET" && request.method !== "HEAD") {
        const origin = request.headers.origin;
        const fetchSite = request.headers["sec-fetch-site"];
        const site = (Array.isArray(fetchSite) ? fetchSite[0] : fetchSite || "").toLowerCase();
        if (site === "cross-site") {
          throw new HttpError(403, "Origin is not allowed");
        }
        if (origin) {
          let originHost = "";
          try {
            originHost = new URL(origin).host;
          } catch {
            throw new HttpError(403, "Origin is not allowed");
          }
          if (originHost.toLowerCase() !== host.toLowerCase()) {
            throw new HttpError(403, "Origin is not allowed");
          }
        }
      }
      const cookies = readCookies(request);
      const session = await dependencies.sessionRepository.read(cookies.session || "");
      const found = session ? await dependencies.accountRepository.findAccount(session.address) : null;
      const account = found && !found.disabled ? found : null;
      const pathName = url.pathname;
      const body =
        request.method === "GET" ||
        request.method === "HEAD" ||
        (request.method === "DELETE" && pathName !== ApiEndpoint.Backup)
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
