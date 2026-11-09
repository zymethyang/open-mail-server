import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServerPort } from "../../../../src/components/configuration/enums/serverPort.js";

describe("server ports", () => {
  it("keeps the protocol ports", () => {
    assert.equal(ServerPort.Web, 443);
    assert.equal(ServerPort.Smtp, 25);
    assert.equal(ServerPort.SmtpSecure, 465);
    assert.equal(ServerPort.SmtpSubmission, 587);
    assert.equal(ServerPort.Imap, 143);
    assert.equal(ServerPort.ImapSecure, 993);
    assert.equal(ServerPort.Pop3, 110);
    assert.equal(ServerPort.Pop3Secure, 995);
  });
});
