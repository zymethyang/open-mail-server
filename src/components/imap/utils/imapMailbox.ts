import type { MessageRecord } from "../../message/interfaces/mailTypes.js";
import {
  buildEnvelope,
  filterHeaderFields,
  formatInternalDate,
  quoteImap,
  rawBufferFromMessage,
  splitHeaderAndBody
} from "../../mime/index.js";
import type { FetchItem } from "../interfaces/fetchItem.js";
export type { FetchItem };

export type ImapToken = string | ImapToken[];

type FlagField = "seen" | "answered" | "flagged" | "deleted" | "draft";

const flagFields: Array<[string, FlagField]> = [
  ["\\Seen", "seen"],
  ["\\Answered", "answered"],
  ["\\Flagged", "flagged"],
  ["\\Deleted", "deleted"],
  ["\\Draft", "draft"]
];

export function tokenizeImap(input: string): ImapToken[] {
  const tokens: ImapToken[] = [];
  let index = 0;

  function skipSpace(): void {
    while (input[index] === " ") {
      index += 1;
    }
  }

  function readQuoted(): string {
    index += 1;
    let value = "";
    while (index < input.length) {
      if (input[index] === "\\") {
        value += input[index + 1] || "";
        index += 2;
        continue;
      }
      if (input[index] === '"') {
        index += 1;
        return value;
      }
      value += input[index];
      index += 1;
    }
    return value;
  }

  function readAtom(): string {
    const start = index;
    while (index < input.length) {
      const character = input[index];
      if (character === " " || character === ")" || character === "(") {
        break;
      }
      if (character === "[") {
        let depth = 0;
        while (index < input.length) {
          if (input[index] === "[") {
            depth += 1;
          } else if (input[index] === "]") {
            depth -= 1;
            index += 1;
            if (depth === 0) {
              break;
            }
            continue;
          }
          index += 1;
        }
        continue;
      }
      index += 1;
    }
    return input.slice(start, index);
  }

  function readToken(): ImapToken {
    if (input[index] === '"') {
      return readQuoted();
    }
    if (input[index] === "(") {
      index += 1;
      const list: ImapToken[] = [];
      while (index < input.length && input[index] !== ")") {
        skipSpace();
        if (index >= input.length || input[index] === ")") {
          break;
        }
        list.push(readToken());
        skipSpace();
      }
      if (input[index] === ")") {
        index += 1;
      }
      return list;
    }
    return readAtom();
  }

  while (index < input.length) {
    skipSpace();
    if (index >= input.length) {
      break;
    }
    tokens.push(readToken());
  }
  return tokens;
}

export function flagList(message: MessageRecord): string {
  const names = flagFields.filter(([, field]) => message[field]).map(([name]) => name);
  return `FLAGS (${names.join(" ")})`;
}

export function parseStoreMode(word: string): { mode: "add" | "remove" | "replace"; silent: boolean } | null {
  const upper = word.toUpperCase();
  const silent = upper.endsWith(".SILENT");
  const base = silent ? upper.slice(0, -".SILENT".length) : upper;
  if (base === "+FLAGS") {
    return { mode: "add", silent };
  }
  if (base === "-FLAGS") {
    return { mode: "remove", silent };
  }
  if (base === "FLAGS") {
    return { mode: "replace", silent };
  }
  return null;
}

export function applyFlags(
  message: Pick<MessageRecord, FlagField>,
  mode: "add" | "remove" | "replace",
  flagNames: string[]
): Pick<MessageRecord, FlagField> {
  const next: Record<FlagField, boolean> = {
    seen: Boolean(message.seen),
    answered: Boolean(message.answered),
    flagged: Boolean(message.flagged),
    deleted: Boolean(message.deleted),
    draft: Boolean(message.draft)
  };
  const known = flagNames
    .map((name) => flagFields.find(([flag]) => flag.toLowerCase() === String(name).toLowerCase()))
    .filter((item): item is [string, FlagField] => Boolean(item));
  if (mode === "replace") {
    for (const field of Object.keys(next) as FlagField[]) {
      next[field] = false;
    }
  }
  for (const [, field] of known) {
    next[field] = mode !== "remove";
  }
  return next;
}

export function selectedMessages(messages: MessageRecord[], setText: string, useUniqueIdentifier: boolean): Array<{ message: MessageRecord; sequence: number }> {
  const highestUnique = messages.reduce((highest, message) => Math.max(highest, message.uniqueIdentifier), 0);
  const highestSequence = messages.length;
  const selected: Array<{ message: MessageRecord; sequence: number }> = [];
  const seenIdentifiers = new Set<string>();
  for (const part of String(setText || "").split(",")) {
    if (!part) {
      continue;
    }
    const [startText, endText] = part.includes(":") ? part.split(":") : [part, part];
    const resolveNumber = (token: string) => {
      if (token === "*") {
        return useUniqueIdentifier ? highestUnique : highestSequence;
      }
      const number = Number(token);
      return Number.isFinite(number) ? number : 0;
    };
    const start = resolveNumber(startText);
    const end = resolveNumber(endText || startText);
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    messages.forEach((message, index) => {
      const number = useUniqueIdentifier ? message.uniqueIdentifier : index + 1;
      if (number >= low && number <= high && !seenIdentifiers.has(message.identifier)) {
        seenIdentifiers.add(message.identifier);
        selected.push({ message, sequence: index + 1 });
      }
    });
  }
  return selected;
}

function parseImapDate(value: string): number | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
  if (!match) {
    return null;
  }
  const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2].toLowerCase());
  if (monthIndex < 0) {
    return null;
  }
  return Date.UTC(Number(match[3]), monthIndex, Number(match[1]));
}

function dayNumber(isoDate: string): number {
  const date = new Date(isoDate);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function fieldText(message: MessageRecord, word: string): string {
  if (word === "FROM") {
    return `${message.fromName || ""} ${message.fromAddress || ""}`;
  }
  if (word === "TO") {
    return (message.toAddresses || []).join(" ");
  }
  if (word === "CC") {
    return (message.copyAddresses || []).join(" ");
  }
  if (word === "SUBJECT") {
    return message.subject || "";
  }
  if (word === "BODY") {
    return message.text || "";
  }
  return `${message.fromName || ""} ${message.fromAddress || ""} ${(message.toAddresses || []).join(" ")} ${message.subject || ""} ${message.text || ""}`;
}

export function compileSearch(tokens: ImapToken[], messages: MessageRecord[], useUniqueIdentifier: boolean): (message: MessageRecord) => boolean {
  let index = 0;
  const working = [...tokens];
  if (String(working[0] || "").toUpperCase() === "CHARSET") {
    working.splice(0, 2);
  }

  function parseKey(): (message: MessageRecord) => boolean {
    if (index >= working.length) {
      return () => true;
    }
    const token = working[index];
    index += 1;
    if (Array.isArray(token)) {
      return compileSearch(token, messages, useUniqueIdentifier);
    }
    const word = String(token).toUpperCase();
    if (word === "NOT") {
      const inner = parseKey();
      return (message) => !inner(message);
    }
    if (word === "OR") {
      const left = parseKey();
      const right = parseKey();
      return (message) => left(message) || right(message);
    }
    if (word === "ALL") {
      return () => true;
    }
    if (word === "UNSEEN" || word === "NEW") {
      return (message) => !message.seen;
    }
    if (word === "SEEN") {
      return (message) => message.seen;
    }
    if (word === "DELETED" || word === "UNDELETED") {
      return (message) => (word === "DELETED" ? message.deleted : !message.deleted);
    }
    if (word === "DRAFT" || word === "UNDRAFT") {
      return (message) => (word === "DRAFT" ? message.draft : !message.draft);
    }
    if (word === "FLAGGED" || word === "UNFLAGGED") {
      return (message) => (word === "FLAGGED" ? message.flagged : !message.flagged);
    }
    if (word === "ANSWERED" || word === "UNANSWERED") {
      return (message) => (word === "ANSWERED" ? message.answered : !message.answered);
    }
    if (word === "RECENT") {
      return () => false;
    }
    if (word === "OLD") {
      return () => true;
    }
    if (["FROM", "TO", "CC", "SUBJECT", "TEXT", "BODY"].includes(word)) {
      const value = String(working[index] ?? "");
      index += 1;
      return (message) => fieldText(message, word).toLowerCase().includes(value.toLowerCase());
    }
    if (word === "HEADER") {
      const name = String(working[index] ?? "");
      const value = String(working[index + 1] ?? "");
      index += 2;
      return (message) => fieldText(message, name.toUpperCase()).toLowerCase().includes(value.toLowerCase());
    }
    if (word === "UID") {
      const setText = String(working[index] ?? "");
      index += 1;
      const matched = new Set(selectedMessages(messages, setText, true).map((item) => item.message.identifier));
      return (message) => matched.has(message.identifier);
    }
    if (word === "LARGER" || word === "SMALLER") {
      const size = Number(working[index] ?? 0);
      index += 1;
      return (message) => (word === "LARGER" ? (message.rawSize || 0) > size : (message.rawSize || 0) < size);
    }
    if (word === "SINCE" || word === "BEFORE" || word === "ON" || word === "SENTSINCE" || word === "SENTBEFORE" || word === "SENTON") {
      const boundary = parseImapDate(String(working[index] ?? ""));
      index += 1;
      return (message) => {
        if (boundary === null) {
          return false;
        }
        const day = dayNumber(message.date);
        if (word.endsWith("SINCE")) {
          return day >= boundary;
        }
        if (word.endsWith("BEFORE")) {
          return day < boundary;
        }
        return day === boundary;
      };
    }
    if (word === "RETURN") {
      if (Array.isArray(working[index])) {
        index += 1;
      }
      return () => true;
    }
    if (word === "KEYWORD" || word === "UNKEYWORD") {
      index += 1;
      return () => word === "UNKEYWORD";
    }
    if (/^(\d+|\*)$/.test(word) || word.includes(":")) {
      const matched = new Set(selectedMessages(messages, word, useUniqueIdentifier).map((item) => item.message.identifier));
      return (message) => matched.has(message.identifier);
    }
    throw Object.assign(new Error(`Unsupported search key ${word}`), { imapStatus: "NO" });
  }

  const parts: Array<(message: MessageRecord) => boolean> = [];
  while (index < working.length) {
    parts.push(parseKey());
  }
  return (message) => parts.every((part) => part(message));
}

export function setsSeen(attribute: string): boolean {
  const upper = attribute.toUpperCase();
  if (upper.includes(".PEEK")) {
    return false;
  }
  if (upper === "RFC822" || upper === "RFC822.TEXT" || upper.startsWith("BODY[")) {
    return !upper.includes("HEADER");
  }
  return false;
}

export function expandAttributes(token: ImapToken | undefined): string[] {
  if (Array.isArray(token)) {
    return token.flatMap((item) => expandAttributes(item));
  }
  const word = String(token || "FLAGS").toUpperCase();
  if (word === "ALL") {
    return ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE"];
  }
  if (word === "FAST") {
    return ["FLAGS", "INTERNALDATE", "RFC822.SIZE"];
  }
  if (word === "FULL") {
    return ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE", "BODY"];
  }
  return [String(token || "FLAGS")];
}

function sectionBytes(message: MessageRecord, rawBuffer: Buffer, section: string): Buffer {
  const parts = splitHeaderAndBody(rawBuffer);
  if (!section) {
    return rawBuffer;
  }
  const upper = section.toUpperCase().trim();
  if (upper === "HEADER") {
    return Buffer.concat([parts.header, Buffer.from("\r\n\r\n")]);
  }
  if (upper === "TEXT") {
    return parts.body;
  }
  const fieldMatch = /^HEADER\.FIELDS(?:\.NOT)?\s*\((.*)\)\s*$/i.exec(section.trim());
  if (fieldMatch) {
    const names = fieldMatch[1].split(/\s+/).filter(Boolean);
    return filterHeaderFields(parts.header, names, !/^HEADER\.FIELDS\.NOT/i.test(section));
  }
  if (upper === "1" || upper === "1.TEXT" || upper === "1.TEXT") {
    return Buffer.from(message.text || "", "utf8");
  }
  if (upper === "1.MIME") {
    return Buffer.from("Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n", "utf8");
  }
  const attachmentNumber = Number(upper);
  if (Number.isInteger(attachmentNumber) && attachmentNumber >= 2) {
    const attachment = (message.attachments || [])[attachmentNumber - 2];
    if (attachment) {
      return Buffer.from(attachment.contentEncoded || "", "base64");
    }
  }
  return Buffer.alloc(0);
}

function bodyStructure(message: MessageRecord): string {
  const text = message.text || "";
  const size = Buffer.byteLength(text, "utf8");
  const lines = text ? text.split(/\r\n|\n|\r/).length : 0;
  const plain = `("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "8BIT" ${size} ${lines} NIL NIL NIL)`;
  if (!message.attachments?.length) {
    return plain;
  }
  const parts = [plain];
  for (const attachment of message.attachments) {
    parts.push(
      `("APPLICATION" "OCTET-STREAM" NIL NIL NIL "BASE64" ${attachment.size || 0} NIL ("ATTACHMENT" ("FILENAME" ${quoteImap(attachment.fileName || "attachment")})) NIL)`
    );
  }
  return `(${parts.join("")} "MIXED" NIL NIL NIL)`;
}

export function fetchItems(message: MessageRecord, attribute: string): FetchItem[] {
  const partialMatch = /<(\d+)(?:\.(\d+))?>$/.exec(attribute);
  const cleanAttribute = attribute.replace(/<\d+(?:\.\d+)?>$/, "");
  const rawBuffer = rawBufferFromMessage(message);
  const upper = cleanAttribute.toUpperCase();
  let items: FetchItem[] = [];
  if (upper === "UID") {
    items = [{ text: `UID ${message.uniqueIdentifier}` }];
  } else if (upper === "FLAGS") {
    items = [{ text: flagList(message) }];
  } else if (upper === "INTERNALDATE") {
    items = [{ text: `INTERNALDATE "${formatInternalDate(message.date)}"` }];
  } else if (upper === "RFC822.SIZE") {
    items = [{ text: `RFC822.SIZE ${message.rawSize || rawBuffer.length}` }];
  } else if (upper === "ENVELOPE") {
    items = [{ text: buildEnvelope(message) }];
  } else if (upper === "BODY" || upper === "BODYSTRUCTURE") {
    items = [{ text: `${upper === "BODY" ? "BODY" : "BODYSTRUCTURE"} ${bodyStructure(message)}` }];
  } else if (upper === "RFC822") {
    items = [{ prefix: "RFC822", buffer: rawBuffer }];
  } else if (upper === "RFC822.HEADER") {
    items = [{ prefix: "RFC822.HEADER", buffer: sectionBytes(message, rawBuffer, "HEADER") }];
  } else if (upper === "RFC822.TEXT") {
    items = [{ prefix: "RFC822.TEXT", buffer: sectionBytes(message, rawBuffer, "TEXT") }];
  } else {
    const bodyMatch = /^BODY(?:\.PEEK)?\[([\s\S]*)\]$/i.exec(cleanAttribute);
    if (bodyMatch) {
      items = [{ prefix: `BODY[${bodyMatch[1]}]`, buffer: sectionBytes(message, rawBuffer, bodyMatch[1]) }];
    }
  }
  if (partialMatch) {
    const start = Number(partialMatch[1]);
    const count = partialMatch[2] ? Number(partialMatch[2]) : undefined;
    return items.map((item) => {
      if (!item.buffer) {
        return item;
      }
      const slice = item.buffer.subarray(start, count === undefined ? undefined : start + count);
      return { ...item, prefix: `${item.prefix}<${start}>`, buffer: slice };
    });
  }
  return items;
}

export function listRequest(tokens: ImapToken[]): { pattern: string; specialUseOnly: boolean } {
  let index = 2;
  let specialUseOnly = false;
  const selection = tokens[index];
  if (Array.isArray(selection)) {
    specialUseOnly = selection.some((item) => String(item).toUpperCase() === "SPECIAL-USE");
    index += 1;
  }
  const reference = String(tokens[index] ?? "");
  const mailbox = String(tokens[index + 1] ?? "");
  const pattern = reference ? `${reference}${mailbox || "*"}` : mailbox || "*";
  return { pattern, specialUseOnly };
}

export function matchesPattern(name: string, pattern: string): boolean {
  if (!pattern || pattern === "*" || pattern === "%" || pattern === '""') {
    return true;
  }
  const expression = `^${pattern
    .replace(/[.+?^${}()|[\]\\*]/g, "\\$&")
    .replace(/\\\*/g, ".*")
    .replace(/%/g, "[^/]*")}$`;
  return new RegExp(expression, "i").test(name);
}
