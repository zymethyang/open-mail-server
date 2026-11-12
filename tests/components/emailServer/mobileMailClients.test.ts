import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { startEmailServer } from "../../../src/components/emailServer/index.js";
import type { RunningEmailServer } from "../../../src/components/emailServer/interfaces/runningEmailServer.js";
import { connectPlain, connectTrustedTls, readResponse, upgradeToTrustedTls } from "../../support/protocolClient.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { testConfiguration } from "../../support/testConfiguration.js";

describe("mobile mail clients", { concurrency: 1 }, () => {
  let running: RunningEmailServer | undefined;
  let storageDirectory = "";
  let certificate = "";

  function server(): RunningEmailServer {
    if (!running) {
      throw new Error("The mail server did not start");
    }
    return running;
  }

  before(async () => {
    storageDirectory = await createTemporaryStorage();
    running = await startEmailServer({ configuration: testConfiguration(storageDirectory) });
    certificate = await readFile(path.join(storageDirectory, "certificates", "certificate.pem"), "utf8");
    const setup = await fetch(`http://127.0.0.1:${listenerPort(server(), "Web", "HTTP")}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "203.0.113.10",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      })
    });
    assert.equal(setup.status, 201);

    const receive = await connectPlain(listenerPort(server(), "SMTP", "Plain and STARTTLS"));
    try {
      await readResponse(receive);
      receive.write("EHLO phone.example\r\n");
      await readResponse(receive);
      receive.write("MAIL FROM:<outside@example.test>\r\n");
      await readResponse(receive);
      receive.write("RCPT TO:<ada@acme.test>\r\n");
      await readResponse(receive);
      receive.write("DATA\r\n");
      await readResponse(receive);
      receive.write("From: Outside <outside@example.test>\r\nTo: ada@acme.test\r\nSubject: Phone delivery\r\n\r\nHello from outside.\r\n.\r\n");
      assert.match(await readResponse(receive), /^250 /);
      receive.write("QUIT\r\n");
      await readResponse(receive);
    } finally {
      receive.end();
    }
  });

  after(async () => {
    await running?.stop();
    if (storageDirectory) {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("lets an iOS or Spark mailbox read mail over implicit TLS", async () => {
    const mailbox = await connectTrustedTls(listenerPort(server(), "IMAP", "TLS"), certificate, "acme.test");
    try {
      const greeting = await readResponse(mailbox);
      assert.match(greeting, /IMAP4rev1/);
      assert.match(greeting, /AUTH=PLAIN/);
      assert.doesNotMatch(greeting, /STARTTLS/);
      mailbox.write('a1 ID ("name" "Spark" "os" "iOS")\r\n');
      assert.match(await readResponse(mailbox, { tag: "a1" }), /a1 OK/);
      mailbox.write("a2 LOGIN ada@acme.test correct-horse\r\n");
      assert.match(await readResponse(mailbox, { tag: "a2" }), /a2 OK/);
      mailbox.write('a3 LIST (SPECIAL-USE) "" "*"\r\n');
      const listed = await readResponse(mailbox, { tag: "a3" });
      assert.match(listed, /\\Inbox/);
      assert.match(listed, /\\Sent/);
      assert.match(listed, /\\Drafts/);
      assert.match(listed, /\\Trash/);
      assert.match(listed, /\\Junk/);
      mailbox.write("a4 SELECT INBOX\r\n");
      assert.match(await readResponse(mailbox, { tag: "a4" }), /a4 OK \[READ-WRITE\]/);
      mailbox.write("a5 UID FETCH 1:* (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])\r\n");
      const fetched = await readResponse(mailbox, { tag: "a5" });
      assert.match(fetched, /Phone delivery/);
      assert.match(fetched, /FROM/);
      mailbox.write("a6 UID SEARCH CHARSET UTF-8 UNSEEN\r\n");
      assert.match(await readResponse(mailbox, { tag: "a6" }), /\* SEARCH \d+/);
      mailbox.write("a7 UID SEARCH RETURN (ALL) ALL\r\n");
      assert.match(await readResponse(mailbox, { tag: "a7" }), /\* SEARCH \d+/);
      mailbox.write("a8 LOGOUT\r\n");
      await readResponse(mailbox, { tag: "a8" });
    } finally {
      mailbox.end();
    }
  });

  it("lets Android submit mail with AUTH LOGIN over implicit TLS", async () => {
    const submission = await connectTrustedTls(listenerPort(server(), "SMTP", "TLS"), certificate, "acme.test");
    try {
      await readResponse(submission);
      submission.write("EHLO android.example\r\n");
      const offered = await readResponse(submission);
      assert.match(offered, /AUTH PLAIN LOGIN/);
      assert.doesNotMatch(offered, /STARTTLS/);
      const username = Buffer.from("ada@acme.test").toString("base64");
      submission.write(`AUTH LOGIN ${username}\r\n`);
      assert.match(await readResponse(submission), /^334 /);
      submission.write(`${Buffer.from("correct-horse").toString("base64")}\r\n`);
      assert.match(await readResponse(submission), /^235 /);
      submission.write("MAIL FROM:<ada@acme.test> BODY=8BITMIME SIZE=80\r\n");
      assert.match(await readResponse(submission), /^250 /);
      submission.write("RCPT TO:<ada@acme.test>\r\n");
      assert.match(await readResponse(submission), /^250 /);
      submission.write("DATA\r\n");
      assert.match(await readResponse(submission), /^354 /);
      submission.write("From: Ada Admin <ada@acme.test>\r\nTo: ada@acme.test\r\nSubject: From Android\r\n\r\nSent with SSL.\r\n.\r\n");
      assert.match(await readResponse(submission), /^250 /);
      submission.write("QUIT\r\n");
      await readResponse(submission);
    } finally {
      submission.end();
    }
  });

  it("lets iOS submit mail with STARTTLS and AUTH PLAIN", async () => {
    const plain = await connectPlain(listenerPort(server(), "SMTP", "STARTTLS"));
    try {
      await readResponse(plain);
      plain.write("EHLO iphone.example\r\n");
      assert.match(await readResponse(plain), /STARTTLS/);
      plain.write("STARTTLS\r\n");
      assert.match(await readResponse(plain), /^220 /);
      const submission = await upgradeToTrustedTls(plain, certificate, "acme.test");
      submission.write("EHLO iphone.example\r\n");
      const offered = await readResponse(submission);
      assert.match(offered, /AUTH PLAIN LOGIN/);
      assert.doesNotMatch(offered, /STARTTLS/);
      const token = Buffer.from("\u0000ada@acme.test\u0000correct-horse").toString("base64");
      submission.write(`AUTH PLAIN ${token}\r\n`);
      assert.match(await readResponse(submission), /^235 /);
      submission.write("MAIL FROM:<ada@acme.test> SIZE=40\r\n");
      assert.match(await readResponse(submission), /^250 /);
      submission.write("RCPT TO:<ada@acme.test>\r\n");
      assert.match(await readResponse(submission), /^250 /);
      submission.write("DATA\r\n");
      await readResponse(submission);
      submission.write("From: Ada Admin <ada@acme.test>\r\nTo: ada@acme.test\r\nSubject: From iOS\r\n\r\nSent with STARTTLS.\r\n.\r\n");
      assert.match(await readResponse(submission), /^250 /);
      submission.write("QUIT\r\n");
      await readResponse(submission);
    } finally {
      plain.end();
    }
  });

  it("lets a phone download mail with POP3 over TLS and after STLS", async () => {
    const secure = await connectTrustedTls(listenerPort(server(), "POP3", "TLS"), certificate, "acme.test");
    try {
      assert.match(await readResponse(secure), /^\+OK/);
      secure.write("CAPA\r\n");
      const capabilities = await readResponse(secure, { dotTerminated: true });
      assert.match(capabilities, /SASL PLAIN LOGIN/);
      assert.doesNotMatch(capabilities, /STLS/);
      secure.write("USER ada@acme.test\r\n");
      assert.match(await readResponse(secure), /^\+OK/);
      secure.write("PASS correct-horse\r\n");
      assert.match(await readResponse(secure), /^\+OK/);
      secure.write("RETR 1\r\n");
      const message = await readResponse(secure, { dotTerminated: true });
      assert.match(message, /Phone delivery/);
      secure.write("QUIT\r\n");
      await readResponse(secure);
    } finally {
      secure.end();
    }

    const plain = await connectPlain(listenerPort(server(), "POP3", "Plain and STLS"));
    try {
      await readResponse(plain);
      plain.write("STLS\r\n");
      assert.match(await readResponse(plain), /^\+OK/);
      const secured = await upgradeToTrustedTls(plain, certificate, "acme.test");
      secured.write("CAPA\r\n");
      const capabilities = await readResponse(secured, { dotTerminated: true });
      assert.doesNotMatch(capabilities, /\r\nSTLS\r\n/);
      const username = Buffer.from("ada@acme.test").toString("base64");
      secured.write(`AUTH LOGIN ${username}\r\n`);
      assert.match(await readResponse(secured), /^\+/);
      secured.write(`${Buffer.from("correct-horse").toString("base64")}\r\n`);
      assert.match(await readResponse(secured), /^\+OK/);
      secured.write("STAT\r\n");
      assert.match(await readResponse(secured), /^\+OK [1-9]/);
      secured.write("QUIT\r\n");
      await readResponse(secured);
    } finally {
      plain.end();
    }
  });
});

function listenerPort(server: RunningEmailServer, name: string, security: string): number {
  const listener = server.listeners.find((item) => item.name === name && item.security === security && item.started);
  if (!listener) {
    throw new Error(`${name} ${security} did not start`);
  }
  return listener.port;
}
