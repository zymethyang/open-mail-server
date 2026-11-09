import { randomBytes } from "node:crypto";
import { months, weekdays } from "../constants/calendar.js";
import type { AttachmentRecord, MessageDraft, ParsedMessage } from "../../message/interfaces/mailTypes.js";
import { isValidAddress, normalizeAddress, splitAddress } from "../../text/index.js";
import type { OutboundAttachment } from "../interfaces/outboundAttachment.js";
export type { OutboundAttachment };

export function formatRfc5322Date(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${weekdays[date.getUTCDay()]}, ${day} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${hours}:${minutes}:${seconds} +0000`;
}

export function formatInternalDate(isoDate: string): string {
  const date = new Date(isoDate);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${day}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()} ${hours}:${minutes}:${seconds} +0000`;
}

function cleanHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function encodeHeaderValue(value: string): string {
  const safe = cleanHeader(value);
  if (!safe || /^[\x20-\x7E]*$/.test(safe)) {
    return safe;
  }
  return `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}

function formatAddressHeader(name: string, address: string): string {
  const safeAddress = normalizeAddress(address);
  const safeName = encodeHeaderValue(name);
  if (!safeName || safeName === safeAddress) {
    return safeAddress;
  }
  if (/^[\x20-\x7E]*$/.test(safeName) && !/["\\]/.test(safeName)) {
    return `"${safeName}" <${safeAddress}>`;
  }
  return `${safeName} <${safeAddress}>`;
}

function safeMessageLocation(location: string): boolean {
  const target = location.trim();
  if (/^(https?:|mailto:)/i.test(target) || /^data:image\/(png|jpeg|jpg|gif|webp)(;|,)/i.test(target)) {
    return true;
  }
  if (!/^cid:/i.test(target) || /javascript:|vbscript:|data:/i.test(target)) {
    return false;
  }
  return /^cid:[^\s"'<>]+$/i.test(target);
}

export function sanitizeMessageHtml(value: string): string {
  const withoutActiveContent = value
    .replace(/<\s*(script|iframe|object|embed|base|meta|link|form|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|base|meta|link|form|svg|math)\b[^>]*\/?\s*>/gi, "");
  return withoutActiveContent
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(\s(?:href|src)\s*=\s*)(["'])([\s\S]*?)\2/gi, (_match, prefix: string, quote: string, location: string) => {
      return safeMessageLocation(location) ? `${prefix}${quote}${location.trim()}${quote}` : `${prefix}${quote}${quote}`;
    })
    .replace(/javascript:|vbscript:|data:text\/html/gi, "");
}

export function createRawMessage(input: {
  fromName: string;
  fromAddress: string;
  toAddresses: string[];
  copyAddresses: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: OutboundAttachment[];
  messageIdentifierHeader: string;
  inReplyTo: string;
  date: Date;
}): Buffer {
  const headers = [
    `From: ${formatAddressHeader(input.fromName, input.fromAddress)}`,
    `To: ${input.toAddresses.map((address) => formatAddressHeader("", address)).join(", ")}`
  ];
  if (input.copyAddresses.length) {
    headers.push(`Cc: ${input.copyAddresses.map((address) => formatAddressHeader("", address)).join(", ")}`);
  }
  headers.push(`Date: ${formatRfc5322Date(input.date)}`, `Subject: ${encodeHeaderValue(input.subject)}`, `Message-ID: ${input.messageIdentifierHeader}`);
  if (input.inReplyTo) {
    headers.push(`In-Reply-To: ${cleanHeader(input.inReplyTo)}`);
  }
  headers.push("MIME-Version: 1.0");
  const text = normalizeBody(input.text);
  const html = sanitizeMessageHtml(input.html || "");
  const attachments = input.attachments || [];
  const textBody = entityPart(["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit"], Buffer.from(text, "utf8"));
  if (!html && !attachments.length) {
    return joinParts([Buffer.from(`${headers.join("\r\n")}\r\n`, "utf8"), textBody]);
  }
  const alternativeParts = [textBody];
  if (html) {
    alternativeParts.push(
      entityPart(["Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: 8bit"], Buffer.from(normalizeBody(html), "utf8"))
    );
  }
  const alternativeBoundary = randomBytes(12).toString("hex");
  const alternative = alternativeParts.length === 1
    ? textBody
    : joinParts([
        Buffer.from(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"\r\n\r\n`, "utf8"),
        multipartBody(alternativeBoundary, alternativeParts)
      ]);
  if (!attachments.length) {
    return joinParts([Buffer.from(`${headers.join("\r\n")}\r\n`, "utf8"), alternative]);
  }
  const mixedBoundary = randomBytes(12).toString("hex");
  const attachmentParts = attachments.map((attachment) => {
    const disposition = attachment.contentIdentifier ? "inline" : "attachment";
    const identifier = attachment.contentIdentifier ? [`Content-ID: <${cleanHeader(attachment.contentIdentifier)}>`] : [];
    const fileName = cleanHeader(attachment.fileName).replace(/"/g, "") || "attachment";
    return entityPart(
      [
        `Content-Type: ${cleanHeader(attachment.contentType) || "application/octet-stream"}; name="${fileName}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: ${disposition}; filename="${fileName}"`,
        ...identifier
      ],
      Buffer.from(wrapBase64(attachment.content), "utf8")
    );
  });
  return joinParts([
    Buffer.from(`${headers.join("\r\n")}\r\nContent-Type: multipart/mixed; boundary="${mixedBoundary}"\r\n\r\n`, "utf8"),
    multipartBody(mixedBoundary, [alternative, ...attachmentParts])
  ]);
}

function normalizeBody(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
}

function wrapBase64(content: Buffer): string {
  const encoded = content.toString("base64");
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76) {
    lines.push(encoded.slice(index, index + 76));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function entityPart(headers: string[], body: Buffer): Buffer {
  return joinParts([Buffer.from(`${headers.join("\r\n")}\r\n\r\n`, "utf8"), body, Buffer.from("\r\n", "utf8")]);
}

function multipartBody(boundary: string, parts: Buffer[]): Buffer {
  const chunks = parts.flatMap((part) => [Buffer.from(`--${boundary}\r\n`, "utf8"), part]);
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return Buffer.concat(chunks);
}

function joinParts(parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}

export function createMessageIdentifier(domain: string): string {
  return `<${randomBytes(12).toString("hex")}@${domain || "localhost"}>`;
}

function decodeQuotedPrintable(value: string): Buffer {
  const normalized = value.replace(/=\r\n/g, "").replace(/=\n/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === "=" && /^[0-9A-Fa-f]{2}$/.test(normalized.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(normalized.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    bytes.push(normalized.charCodeAt(index) & 0xff);
  }
  return Buffer.from(bytes);
}

function decodeTransfer(body: Buffer, encoding: string): Buffer {
  const normalized = encoding.toLowerCase();
  if (normalized === "base64") {
    return Buffer.from(body.toString("ascii").replace(/\s+/g, ""), "base64");
  }
  if (normalized === "quoted-printable") {
    return decodeQuotedPrintable(body.toString("latin1"));
  }
  return body;
}

function decodeBytes(bytes: Buffer, charset: string): string {
  const normalized = charset.toLowerCase();
  if (normalized === "iso-8859-1" || normalized === "latin1" || normalized === "windows-1252") {
    return bytes.toString("latin1");
  }
  return bytes.toString("utf8");
}

function decodeEncodedWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_match, charset: string, encoding: string, text: string) => {
    const bytes = encoding.toUpperCase() === "B" ? Buffer.from(text, "base64") : decodeQuotedPrintable(text.replace(/_/g, " "));
    return decodeBytes(bytes, charset);
  });
}

interface HeaderMap {
  [name: string]: string;
}

function parseHeaders(headerText: string): HeaderMap {
  const headers: HeaderMap = {};
  const unfolded = headerText.replace(/\r\n[ \t]+/g, " ").replace(/\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r\n|\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = decodeEncodedWords(line.slice(separator + 1).trim());
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return headers;
}

function headerParameter(value: string, name: string): string {
  const encodedName = new RegExp(`${name}\\*\\s*=\\s*(?:[^']*)'[^']*'([^;]+)`, "i");
  const encodedMatch = encodedName.exec(value);
  if (encodedMatch?.[1]) {
    const encoded = encodedMatch[1].trim().replace(/"/g, "");
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  const pattern = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i");
  const match = pattern.exec(`;${value}`);
  return (match?.[1] || match?.[2] || "").trim();
}

function mediaType(value: string): string {
  return (value.split(";")[0] || "").trim().toLowerCase();
}

interface AddressPiece {
  name: string;
  address: string;
}

function parseAddressHeader(value: string): AddressPiece[] {
  const pieces: AddressPiece[] = [];
  let current = "";
  let quote = false;
  for (const character of value) {
    if (character === '"') {
      quote = !quote;
    }
    if (character === "," && !quote) {
      pieces.push(...parseAddressGroup(current));
      current = "";
      continue;
    }
    current += character;
  }
  pieces.push(...parseAddressGroup(current));
  return pieces.filter((piece) => isValidAddress(piece.address));
}

function displayName(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').trim();
  }
  return trimmed;
}

function parseAddressGroup(value: string): AddressPiece[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const wrapped = /^(.*)<([^<>]+)>$/.exec(trimmed);
  if (wrapped) {
    return [{ name: displayName(wrapped[1]), address: normalizeAddress(wrapped[2]) }];
  }
  return [{ name: "", address: normalizeAddress(trimmed) }];
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

interface MimePart {
  headers: HeaderMap;
  body: Buffer;
  children: MimePart[];
}

function splitBuffer(buffer: Buffer, marker: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  while (start <= buffer.length) {
    const index = buffer.indexOf(marker, start);
    if (index === -1) {
      parts.push(buffer.subarray(start));
      break;
    }
    parts.push(buffer.subarray(start, index));
    start = index + marker.length;
  }
  return parts;
}

function stripLeadingBreak(buffer: Buffer): Buffer {
  if (buffer[0] === 0x0d && buffer[1] === 0x0a) {
    return buffer.subarray(2);
  }
  if (buffer[0] === 0x0a) {
    return buffer.subarray(1);
  }
  return buffer;
}

function parseMime(raw: Buffer): MimePart {
  const crlf = raw.indexOf("\r\n\r\n");
  const lf = raw.indexOf("\n\n");
  const headerEnd = crlf === -1 ? lf : lf === -1 ? crlf : Math.min(crlf, lf);
  const separatorLength = headerEnd === crlf && crlf !== -1 ? 4 : 2;
  const headerText = (headerEnd === -1 ? raw : raw.subarray(0, headerEnd)).toString("utf8");
  const body = headerEnd === -1 ? Buffer.alloc(0) : raw.subarray(headerEnd + separatorLength);
  const headers = parseHeaders(headerText);
  const contentType = headers["content-type"] || "text/plain";
  const type = mediaType(contentType);
  if (type.startsWith("multipart/")) {
    const boundary = headerParameter(contentType, "boundary");
    const children: MimePart[] = [];
    if (boundary) {
      const sections = splitBuffer(body, Buffer.from(`--${boundary}`)).slice(1);
      for (const section of sections) {
        const content = stripLeadingBreak(section);
        const ending = content.subarray(0, 2).toString("ascii");
        if (ending.startsWith("--")) {
          break;
        }
        children.push(parseMime(content));
      }
    }
    return { headers, body: Buffer.alloc(0), children };
  }
  const encoding = headers["content-transfer-encoding"] || "8bit";
  return { headers, body: decodeTransfer(body, encoding), children: [] };
}

function collectParts(part: MimePart, textParts: string[], htmlParts: string[], attachments: AttachmentRecord[]): void {
  if (part.children.length) {
    for (const child of part.children) {
      collectParts(child, textParts, htmlParts, attachments);
    }
    return;
  }
  const contentType = part.headers["content-type"] || "text/plain";
  const type = mediaType(contentType);
  const disposition = (part.headers["content-disposition"] || "").toLowerCase();
  const charset = headerParameter(contentType, "charset") || "utf-8";
  const fileName =
    headerParameter(part.headers["content-disposition"] || "", "filename") ||
    headerParameter(contentType, "name");
  if ((type === "text/plain" || type === "text/html") && !disposition.startsWith("attachment") && !fileName) {
    const text = decodeBytes(part.body, charset);
    if (type === "text/html") {
      htmlParts.push(text);
    } else {
      textParts.push(text);
    }
    return;
  }
  if (!part.body.length && !fileName) {
    return;
  }
  const contentIdentifier = (part.headers["content-id"] || "").replace(/^<|>$/g, "").trim();
  attachments.push({
    fileName: cleanHeader(fileName) || `attachment-${attachments.length + 1}`,
    contentType: type || "application/octet-stream",
    size: part.body.length,
    contentEncoded: part.body.toString("base64"),
    contentIdentifier
  });
}

function mailboxAddressesInHeader(value: string | undefined): string[] | null {
  if (!value) {
    return null;
  }
  const pattern = /[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)*[a-z0-9-]+/gi;
  return [...value.matchAll(pattern)].map((match) => normalizeAddress(match[0])).filter((address) => isValidAddress(address));
}

export function senderMailboxAddresses(rawBuffer: Buffer): { from: string[] | null; sender: string[] | null } {
  const headers = parseMime(rawBuffer).headers;
  return {
    from: mailboxAddressesInHeader(headers.from),
    sender: mailboxAddressesInHeader(headers.sender)
  };
}

export function parseRawMessage(rawBuffer: Buffer): ParsedMessage {
  const part = parseMime(rawBuffer);
  const textParts: string[] = [];
  const htmlParts: string[] = [];
  const attachments: AttachmentRecord[] = [];
  collectParts(part, textParts, htmlParts, attachments);
  const from = parseAddressHeader(part.headers.from || "")[0];
  const dateValue = part.headers.date ? new Date(part.headers.date) : new Date();
  return {
    fromName: from?.name || "",
    fromAddress: from?.address || "",
    toAddresses: parseAddressHeader(part.headers.to || "").map((item) => item.address),
    copyAddresses: parseAddressHeader(part.headers.cc || "").map((item) => item.address),
    blindCopyAddresses: parseAddressHeader(part.headers.bcc || "").map((item) => item.address),
    subject: part.headers.subject || "",
    text: textParts.join("\n").trim() || stripHtml(htmlParts.join(" ")),
    html: htmlParts.join("\n"),
    date: Number.isNaN(dateValue.getTime()) ? new Date().toISOString() : dateValue.toISOString(),
    messageIdentifierHeader: part.headers["message-id"] || "",
    inReplyTo: part.headers["in-reply-to"] || "",
    attachments
  };
}

export function createStoredMessage(parsed: ParsedMessage, rawBuffer: Buffer, envelopeFromAddress: string): MessageDraft {
  const fromAddress = parsed.fromAddress || normalizeAddress(envelopeFromAddress);
  return {
    fromName: parsed.fromName || "",
    fromAddress,
    toAddresses: parsed.toAddresses,
    copyAddresses: parsed.copyAddresses,
    subject: parsed.subject || "(no subject)",
    text: parsed.text || "",
    html: parsed.html || "",
    date: parsed.date,
    messageIdentifierHeader: parsed.messageIdentifierHeader || createMessageIdentifier(splitAddress(fromAddress).host),
    inReplyTo: parsed.inReplyTo || "",
    seen: false,
    answered: false,
    flagged: false,
    deleted: false,
    draft: false,
    rawEncoded: rawBuffer.toString("base64"),
    rawSize: rawBuffer.length,
    attachments: parsed.attachments
  };
}

export function rawBufferFromMessage(message: { rawEncoded?: string }): Buffer {
  return Buffer.from(message.rawEncoded || "", "base64");
}

export function createSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 140);
}

export function splitHeaderAndBody(rawBuffer: Buffer): { header: Buffer; body: Buffer } {
  const marker = Buffer.from("\r\n\r\n");
  const index = rawBuffer.indexOf(marker);
  if (index === -1) {
    return { header: rawBuffer, body: Buffer.alloc(0) };
  }
  return {
    header: rawBuffer.subarray(0, index),
    body: rawBuffer.subarray(index + marker.length)
  };
}

export function filterHeaderFields(headerBuffer: Buffer, fieldNames: string[], includeMatches: boolean): Buffer {
  const lines = headerBuffer.toString("utf8").split(/\r\n|\n/);
  const wanted = new Set(fieldNames.map((name) => name.toLowerCase()));
  const kept: string[] = [];
  let keepCurrent = false;
  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (keepCurrent) {
        kept.push(line);
      }
      continue;
    }
    const name = line.split(":")[0].toLowerCase();
    keepCurrent = includeMatches ? wanted.has(name) : !wanted.has(name);
    if (keepCurrent) {
      kept.push(line);
    }
  }
  return Buffer.from(kept.length ? `${kept.join("\r\n")}\r\n\r\n` : "\r\n", "utf8");
}

export function quoteImap(value: unknown): string {
  const text = String(value ?? "");
  if (text === "") {
    return '""';
  }
  if (/^[\x20-\x7E]*$/.test(text) && !/["\\]/.test(text)) {
    return `"${text}"`;
  }
  if (/^[\x20-\x7E]*$/.test(text)) {
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `{${Buffer.byteLength(text, "utf8")}}\r\n${text}`;
}

export function imapAddressGroup(addresses: string[], namesByAddress = new Map<string, string>()): string {
  if (!addresses.length) {
    return "NIL";
  }
  const items = addresses.map((address) => {
    const parts = splitAddress(address);
    const name = namesByAddress.get(address) || "";
    const personal = name ? quoteImap(name) : "NIL";
    return `(${personal} NIL ${quoteImap(parts.mailbox)} ${quoteImap(parts.host)})`;
  });
  return `(${items.join("")})`;
}

export function buildEnvelope(message: MessageDraft): string {
  const names = new Map<string, string>();
  if (message.fromAddress) {
    names.set(message.fromAddress, message.fromName || "");
  }
  const date = message.date ? quoteImap(formatRfc5322Date(new Date(message.date))) : "NIL";
  const subject = message.subject ? quoteImap(message.subject) : '""';
  const from = imapAddressGroup(message.fromAddress ? [message.fromAddress] : [], names);
  const to = imapAddressGroup(message.toAddresses);
  const copy = imapAddressGroup(message.copyAddresses);
  const reply = message.inReplyTo ? quoteImap(message.inReplyTo) : "NIL";
  const identifier = message.messageIdentifierHeader ? quoteImap(message.messageIdentifierHeader) : "NIL";
  return `ENVELOPE (${date} ${subject} ${from} ${from} ${from} ${to} ${copy} NIL ${reply} ${identifier})`;
}
