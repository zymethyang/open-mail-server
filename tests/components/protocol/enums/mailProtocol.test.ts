import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailProtocol } from "../../../../src/components/protocol/enums/mailProtocol.js";

describe("mail protocol", () => {
  it("keeps the values written to mail storage", () => {
    assert.equal(MailProtocol.Smtp, "smtp");
    assert.equal(MailProtocol.Imap, "imap");
    assert.equal(MailProtocol.Pop3, "pop3");
    assert.equal(MailProtocol.Web, "web");
  });
});
