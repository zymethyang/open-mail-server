import type { MessageDraft, MessageRecord } from "../../src/components/message/interfaces/mailTypes.js";

export function sampleMessage(overrides: Partial<MessageDraft> = {}): MessageDraft {
  const rawMessage = Buffer.from("From: ada@acme.test\r\nTo: ada@acme.test\r\nSubject: Hello\r\n\r\nHello\r\n");
  return {
    fromName: "Ada Admin",
    fromAddress: "ada@acme.test",
    toAddresses: ["ada@acme.test"],
    copyAddresses: [],
    subject: "Hello",
    text: "Hello",
    html: "",
    date: "2026-11-04T12:00:00.000Z",
    messageIdentifierHeader: "<sample@acme.test>",
    inReplyTo: "",
    seen: false,
    answered: false,
    flagged: false,
    deleted: false,
    draft: false,
    rawEncoded: rawMessage.toString("base64"),
    rawSize: rawMessage.length,
    attachments: [],
    ...overrides
  };
}

export function sampleRecord(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    ...sampleMessage(),
    identifier: "abcdef0123456789abcdef01",
    uniqueIdentifier: 1,
    folderName: "inbox",
    ...overrides
  };
}
