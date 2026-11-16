import type http from "node:http";
import tls from "node:tls";
import { randomBytes } from "node:crypto";
import type { MessageRecord } from "../../message/interfaces/mailTypes.js";
import type { PublicAccount } from "../../account/interfaces/accountRecord.js";
import { AccountRole } from "../../account/enums/accountRole.js";
import { HttpError } from "../../httpError/index.js";
import { displayedImageType } from "../utils/displayedImageType.js";
import type { OutboundAttachment } from "../../mime/index.js";
import { createSnippet } from "../../mime/index.js";
import type { ServerRequest, PendingSignIn } from "../interfaces/serverRequest.js";

export function writeSessionCookie(response: http.ServerResponse, identifier: string, secure: boolean): void {
  response.setHeader("Set-Cookie", [
    cookieLine("session", identifier, secure, identifier ? 7 * 24 * 60 * 60 : 0),
    cookieLine("pending", "", secure, 0)
  ]);
}

export function cookieLine(name: string, value: string, secure: boolean, maxAge: number): string {
  const secureFlag = secure ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureFlag}`;
}

export function readCookies(request: http.IncomingMessage): Record<string, string> {
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

export function connectionIsSecure(request: http.IncomingMessage): boolean {
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

const pendingSignIns = new Map<string, PendingSignIn>();

export function writePendingSignIn(response: http.ServerResponse, address: string, secure: boolean): void {
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

export function readPendingSignIn(request: http.IncomingMessage): string {
  const identifier = readCookies(request).pending || "";
  const pending = pendingSignIns.get(identifier);
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingSignIns.delete(identifier);
    return "";
  }
  return pending.address;
}

export function clearPendingSignIn(request: http.IncomingMessage): void {
  pendingSignIns.delete(readCookies(request).pending || "");
}

export function attachmentDownloadHeaders(fileName: string, contentType: string, length: number): Record<string, string | number> {
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

export function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

export function scheduleProcessRestart(response: http.ServerResponse, requestProcessRestart?: () => void): void {
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

export function textValue(value: unknown): string {
  return String(value ?? "");
}

export function limitsFromBody(value: unknown): {
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
    const parsed = Number(record[name]);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new HttpError(400, `${name} must be a non-negative whole number`);
    }
    limits[name] = parsed;
  }
  return Object.keys(limits).length ? limits : undefined;
}

export function readOutboundAttachments(value: unknown, maximumBytes: number): OutboundAttachment[] {
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

export function summary(record: MessageRecord) {
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

export function requireAccount(context: ServerRequest): PublicAccount {
  if (!context.account) {
    throw new HttpError(401, "Sign in required");
  }
  return context.account;
}

export function requireAdministrator(context: ServerRequest): PublicAccount {
  const account = requireAccount(context);
  if (account.role !== AccountRole.Administrator) {
    throw new HttpError(403, "Administrator access is required");
  }
  return account;
}
