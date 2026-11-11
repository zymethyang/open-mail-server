import type { MessageRecord, MessageSummary } from "../interfaces/mailTypes.js";
import { createSnippet } from "../../mime/index.js";

export function messageSummary(record: MessageRecord): MessageSummary {
  return {
    identifier: record.identifier,
    uniqueIdentifier: record.uniqueIdentifier,
    folderName: record.folderName,
    fromName: record.fromName || "",
    fromAddress: record.fromAddress || "",
    toAddresses: record.toAddresses || [],
    copyAddresses: record.copyAddresses || [],
    subject: record.subject || "",
    date: record.date || "",
    messageIdentifierHeader: record.messageIdentifierHeader || "",
    inReplyTo: record.inReplyTo || "",
    seen: Boolean(record.seen),
    answered: Boolean(record.answered),
    flagged: Boolean(record.flagged),
    deleted: Boolean(record.deleted),
    draft: Boolean(record.draft),
    keywords: record.keywords || [],
    rawSize: record.rawSize || 0,
    snippet: record.snippet || createSnippet(record.text || "")
  };
}

export function messageFromSummary(summary: MessageSummary): MessageRecord {
  return {
    ...summary,
    text: "",
    html: "",
    rawEncoded: "",
    attachments: []
  };
}

export function messageWithSummary(record: MessageRecord, summary: MessageSummary): MessageRecord {
  return {
    ...record,
    ...summary,
    text: record.text,
    html: record.html,
    rawEncoded: record.rawEncoded,
    attachments: record.attachments
  };
}
