import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ImapCommand } from "../../../src/components/imap/enums/imapCommand.js";
import { Pop3Command } from "../../../src/components/pop3/enums/pop3Command.js";
import { SmtpCommand } from "../../../src/components/smtp/enums/smtpCommand.js";

describe("protocol commands", () => {
  it("keeps the SMTP commands", () => {
    assert.deepEqual(Object.values(SmtpCommand), [
      "EHLO",
      "HELO",
      "NOOP",
      "RSET",
      "QUIT",
      "HELP",
      "VRFY",
      "EXPN",
      "STARTTLS",
      "AUTH",
      "MAIL",
      "RCPT",
      "DATA"
    ]);
  });

  it("keeps the IMAP commands", () => {
    assert.deepEqual(Object.values(ImapCommand), [
      "CAPABILITY",
      "NOOP",
      "CHECK",
      "LOGOUT",
      "ID",
      "ENABLE",
      "NAMESPACE",
      "STARTTLS",
      "LOGIN",
      "AUTHENTICATE",
      "LIST",
      "LSUB",
      "STATUS",
      "SELECT",
      "EXAMINE",
      "CREATE",
      "DELETE",
      "RENAME",
      "SUBSCRIBE",
      "UNSUBSCRIBE",
      "CLOSE",
      "UNSELECT",
      "EXPUNGE",
      "IDLE",
      "DONE",
      "FETCH",
      "SEARCH",
      "STORE",
      "COPY",
      "MOVE",
      "APPEND",
      "UID"
    ]);
  });

  it("keeps the POP3 commands", () => {
    assert.deepEqual(Object.values(Pop3Command), ["CAPA", "STLS", "USER", "PASS", "AUTH", "QUIT", "NOOP", "STAT", "RSET", "LIST", "UIDL", "RETR", "TOP", "DELE"]);
  });
});
