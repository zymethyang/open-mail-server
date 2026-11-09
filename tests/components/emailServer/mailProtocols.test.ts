import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startEmailServer } from "../../../src/components/emailServer/index.js";
import type { RunningEmailServer } from "../../../src/components/emailServer/interfaces/runningEmailServer.js";
import { connectPlain, connectTls, readResponse } from "../../support/protocolClient.js";
import { startSmtpSink, type SmtpSink } from "../../support/smtpSink.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { testConfiguration } from "../../support/testConfiguration.js";

describe("mail protocol flow", { concurrency: 1 }, () => {
  let sink: SmtpSink | undefined;
  let running: RunningEmailServer | undefined;
  let storageDirectory = "";
  let administratorCookie = "";

  function server(): RunningEmailServer {
    if (!running) {
      throw new Error("The mail server did not start");
    }
    return running;
  }

  before(async () => {
    storageDirectory = await createTemporaryStorage();
    sink = await startSmtpSink();
    const sinkPort = sink.port;
    const configuration = testConfiguration(storageDirectory);
    configuration.maximumMessageBytes = 2000;
    running = await startEmailServer({
      configuration,
      mailExchangeResolver: {
        async resolve() {
          return [{ host: "127.0.0.1", port: sinkPort }];
        }
      }
    });
    if (!running) {
      throw new Error("The mail server did not start");
    }
    const setup = await fetch(`http://127.0.0.1:${listenerPort(server(), "Web", "HTTP")}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "149.28.152.245",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      })
    });
    assert.equal(setup.status, 201);
    administratorCookie = (setup.headers.getSetCookie?.() || []).map((line) => line.split(";")[0]).find((line) => line.startsWith("session=")) || "";
    assert.match(administratorCookie, /^session=/);
  });

  after(async () => {
    await running?.stop();
    await sink?.stop();
    if (storageDirectory) {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("rejects incomplete SMTP commands and mail the company cannot accept", async () => {
    const receive = await connectPlain(listenerPort(server(), "SMTP", "Plain and STARTTLS"));
    try {
      const greeting = await readResponse(receive);
      assert.match(greeting, /^220 acme\.test /);
      receive.write("MAIL FROM:<outside@example.test>\r\n");
      assert.match(await readResponse(receive), /^503 /);
      receive.write("EHLO\r\n");
      assert.match(await readResponse(receive), /^501 /);
      receive.write("EHLO acme.test\r\n");
      const offered = await readResponse(receive);
      assert.match(offered, /^250-acme\.test/);
      assert.match(offered, /STARTTLS/);
      receive.write("AUTH PLAIN\r\n");
      assert.match(await readResponse(receive), /^530 /);
      receive.write("MAIL FROM:<not an address>\r\n");
      assert.match(await readResponse(receive), /^501 /);
      receive.write("MAIL FROM:<outside@example.test>\r\n");
      assert.match(await readResponse(receive), /^250 /);
      receive.write("DATA\r\n");
      assert.match(await readResponse(receive), /^503 /);
      receive.write("RCPT TO:<not-an-address>\r\n");
      assert.match(await readResponse(receive), /^550 /);
      receive.write("RCPT TO:<missing@acme.test>\r\n");
      assert.match(await readResponse(receive), /^250 /);
      receive.write("DATA\r\n");
      assert.match(await readResponse(receive), /^354 /);
      receive.write("Subject: Missing\r\n\r\nNowhere.\r\n.\r\n");
      assert.match(await readResponse(receive), /^550 /);
      receive.write("RSET\r\n");
      assert.match(await readResponse(receive), /^250 /);
      receive.write("MAIL FROM:<outside@example.test>\r\n");
      await readResponse(receive);
      receive.write("RCPT TO:<person@example.test>\r\n");
      await readResponse(receive);
      receive.write("DATA\r\n");
      await readResponse(receive);
      receive.write("Subject: Relay\r\n\r\nDenied.\r\n.\r\n");
      assert.match(await readResponse(receive), /^550 /);
      receive.write("NOOP\r\n");
      assert.match(await readResponse(receive), /^250 /);
      receive.write("VRFY ada@acme.test\r\n");
      assert.match(await readResponse(receive), /^252 /);
      receive.write("HELP\r\n");
      assert.match(await readResponse(receive), /^214 /);
      receive.write("NOTACOMMAND\r\n");
      assert.match(await readResponse(receive), /^500 /);
      receive.write("QUIT\r\n");
      assert.match(await readResponse(receive), /^221 /);
    } finally {
      receive.end();
    }

    const submission = await connectPlain(listenerPort(server(), "SMTP", "STARTTLS"));
    try {
      await readResponse(submission);
      submission.write("EHLO acme.test\r\n");
      await readResponse(submission);
      submission.write("MAIL FROM:<ada@acme.test>\r\n");
      assert.match(await readResponse(submission), /^530 /);
      submission.write("QUIT\r\n");
      await readResponse(submission);
    } finally {
      submission.end();
    }
  });

  it("receives mail, authenticates, and relays to another server", async () => {
    const receive = await connectPlain(listenerPort(server(), "SMTP", "Plain and STARTTLS"));
    try {
      await readResponse(receive);
      receive.write("EHLO acme.test\r\n");
      await readResponse(receive);
      receive.write("MAIL FROM:<outside@example.test>\r\n");
      await readResponse(receive);
      receive.write("RCPT TO:<ada@acme.test>\r\n");
      await readResponse(receive);
      receive.write("DATA\r\n");
      assert.match(await readResponse(receive), /^354 /);
      receive.write("From: Outside <outside@example.test>\r\nTo: ada@acme.test\r\nSubject: Protocol check\r\n\r\nHello from the test.\r\n..secret\r\n.after the secret\r\n.\r\n");
      assert.match(await readResponse(receive), /^250 /);
      receive.write("QUIT\r\n");
      await readResponse(receive);
    } finally {
      receive.end();
    }

    const secure = await connectTls(listenerPort(server(), "SMTP", "TLS"));
    try {
      await readResponse(secure);
      secure.write("EHLO acme.test\r\n");
      const offered = await readResponse(secure);
      assert.match(offered, /AUTH PLAIN LOGIN/);
      secure.write("AUTH LOGIN\r\n");
      assert.match(await readResponse(secure), /^334 /);
      secure.write(`${Buffer.from("ada@acme.test").toString("base64")}\r\n`);
      assert.match(await readResponse(secure), /^334 /);
      secure.write(`${Buffer.from("wrong-horse").toString("base64")}\r\n`);
      assert.match(await readResponse(secure), /^535 /);
      const token = Buffer.from("\u0000ada@acme.test\u0000correct-horse").toString("base64");
      secure.write(`AUTH PLAIN ${token}\r\n`);
      assert.match(await readResponse(secure), /^235 /);
      secure.write("MAIL FROM:<ada@acme.test>\r\n");
      await readResponse(secure);
      secure.write("RCPT TO:<person@example.test>\r\n");
      await readResponse(secure);
      secure.write("DATA\r\n");
      await readResponse(secure);
      secure.write("From: Ada <ada@acme.test>\r\nTo: person@example.test\r\nSubject: Outbound\r\n\r\nLeaving the building.\r\n.\r\n");
      assert.match(await readResponse(secure), /^250 /);
      secure.write("QUIT\r\n");
      await readResponse(secure);
    } finally {
      secure.end();
    }
    assert.equal(sink?.messages.some((message) => message.includes("Leaving the building.")), true);

    const oversized = await connectPlain(listenerPort(server(), "SMTP", "Plain and STARTTLS"));
    try {
      await readResponse(oversized);
      oversized.write("EHLO acme.test\r\n");
      await readResponse(oversized);
      oversized.write("MAIL FROM:<outside@example.test>\r\n");
      await readResponse(oversized);
      oversized.write("RCPT TO:<ada@acme.test>\r\n");
      await readResponse(oversized);
      oversized.write("DATA\r\n");
      await readResponse(oversized);
      oversized.write(`Subject: Big\r\n\r\n${"x".repeat(2100)}\r\n.\r\n`);
      assert.match(await readResponse(oversized), /^552 /);
    } finally {
      oversized.destroy();
    }
  });

  it("reads the mailbox with IMAP and POP3", async () => {
    const mailbox = await connectPlain(listenerPort(server(), "IMAP", "Plain and STARTTLS"));
    try {
      assert.match(await readResponse(mailbox), /IMAP4rev1/);
      mailbox.write("a1 LOGIN ada@acme.test wrong-horse\r\n");
      assert.match(await readResponse(mailbox, { tag: "a1" }), /NO/);
      mailbox.write("a2 SELECT INBOX\r\n");
      assert.match(await readResponse(mailbox, { tag: "a2" }), /NO/);
      mailbox.write("a3 LOGIN ada@acme.test correct-horse\r\n");
      assert.match(await readResponse(mailbox, { tag: "a3" }), /OK/);
      mailbox.write("a4 SELECT INBOX\r\n");
      assert.match(await readResponse(mailbox, { tag: "a4" }), /EXISTS/);
      mailbox.write("a5 SEARCH SUBJECT Protocol\r\n");
      assert.match(await readResponse(mailbox, { tag: "a5" }), /\* SEARCH/);
      mailbox.write("a6 FETCH 1 (FLAGS ENVELOPE)\r\n");
      const fetched = await readResponse(mailbox, { tag: "a6" });
      assert.match(fetched, /Protocol check|ENVELOPE/);
      mailbox.write("a7 IDLE\r\n");
      assert.match(await readResponse(mailbox), /idling/);
      mailbox.write("DONE\r\n");
      assert.match(await readResponse(mailbox, { tag: "a7" }), /IDLE completed/);
      mailbox.write("a8 LOGOUT\r\n");
      await readResponse(mailbox, { tag: "a8" });
    } finally {
      mailbox.end();
    }

    const download = await connectPlain(listenerPort(server(), "POP3", "Plain and STLS"));
    try {
      assert.match(await readResponse(download), /^\+OK/);
      download.write("PASS correct-horse\r\n");
      assert.match(await readResponse(download), /^-ERR/);
      download.write("USER ada@acme.test\r\n");
      assert.match(await readResponse(download), /^\+OK/);
      download.write("PASS wrong-horse\r\n");
      assert.match(await readResponse(download), /^-ERR/);
      download.write("USER ada@acme.test\r\n");
      await readResponse(download);
      download.write("PASS correct-horse\r\n");
      assert.match(await readResponse(download), /^\+OK/);
      download.write("STAT\r\n");
      assert.match(await readResponse(download), /^\+OK [1-9]/);
      download.write("RETR 1\r\n");
      const retrieved = await readResponse(download, { dotTerminated: true });
      assert.match(retrieved, /Hello from the test\./);
      assert.match(retrieved, /\.\.secret/);
      assert.match(retrieved, /after the secret/);
      download.write("DELE 1\r\n");
      assert.match(await readResponse(download), /^\+OK/);
      download.write("RSET\r\n");
      assert.match(await readResponse(download), /^\+OK/);
      download.write("DELE 1\r\n");
      await readResponse(download);
      download.write("QUIT\r\n");
      assert.match(await readResponse(download), /^\+OK/);
    } finally {
      download.end();
    }
  });

  it("refuses a signed-in mailbox that sends as another mailbox", async () => {
    const created = await fetch(`http://127.0.0.1:${listenerPort(server(), "Web", "HTTP")}/api/mailboxes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: administratorCookie },
      body: JSON.stringify({ address: "bea@acme.test", displayName: "Bea Member", password: "member-horse" })
    });
    assert.equal(created.status, 201);

    const secure = await connectTls(listenerPort(server(), "SMTP", "TLS"));
    try {
      await readResponse(secure);
      secure.write("EHLO acme.test\r\n");
      await readResponse(secure);
      const token = Buffer.from("\u0000Bea@Acme.Test\u0000member-horse").toString("base64");
      secure.write(`AUTH PLAIN ${token}\r\n`);
      assert.match(await readResponse(secure), /^235 /);

      secure.write("MAIL FROM:<ada@acme.test>\r\n");
      assert.match(await readResponse(secure), /^550 /);
      secure.write("RCPT TO:<ada@acme.test>\r\n");
      assert.match(await readResponse(secure), /^503 /);

      secure.write("MAIL FROM:<bea@acme.test>\r\n");
      assert.match(await readResponse(secure), /^250 /);
      secure.write("RCPT TO:<ada@acme.test>\r\n");
      assert.match(await readResponse(secure), /^250 /);
      secure.write("DATA\r\n");
      assert.match(await readResponse(secure), /^354 /);
      secure.write("From: Ada Admin <ada@acme.test>\r\nTo: ada@acme.test\r\nSubject: Forged header\r\n\r\nNot Ada.\r\n.\r\n");
      assert.match(await readResponse(secure), /^550 /);

      secure.write("MAIL FROM:<>\r\n");
      assert.match(await readResponse(secure), /^250 /);
      secure.write("RCPT TO:<ada@acme.test>\r\n");
      await readResponse(secure);
      secure.write("DATA\r\n");
      await readResponse(secure);
      secure.write("From: Ada Admin <ada@acme.test>\r\nTo: ada@acme.test\r\nSubject: Empty envelope forged\r\n\r\nStill not Ada.\r\n.\r\n");
      assert.match(await readResponse(secure), /^550 /);

      secure.write("MAIL FROM:<bea@acme.test>\r\n");
      await readResponse(secure);
      secure.write("RCPT TO:<ada@acme.test>\r\n");
      await readResponse(secure);
      secure.write("DATA\r\n");
      await readResponse(secure);
      secure.write("From: Bea Member <bea@acme.test>\r\nSender: ada@acme.test\r\nTo: ada@acme.test\r\nSubject: Forged sender header\r\n\r\nSender mismatch.\r\n.\r\n");
      assert.match(await readResponse(secure), /^550 /);

      secure.write("MAIL FROM:<Bea@Acme.Test>\r\n");
      assert.match(await readResponse(secure), /^250 /);
      secure.write("RCPT TO:<ada@acme.test>\r\n");
      await readResponse(secure);
      secure.write("DATA\r\n");
      await readResponse(secure);
      secure.write("From: Bea Member <bea@acme.test>\r\nTo: ada@acme.test\r\nSubject: Genuine Bea\r\n\r\nThis is Bea.\r\n.\r\n");
      assert.match(await readResponse(secure), /^250 /);
      secure.write("QUIT\r\n");
      await readResponse(secure);
    } finally {
      secure.end();
    }

    const inbox = await fetch(`http://127.0.0.1:${listenerPort(server(), "Web", "HTTP")}/api/folders/inbox/messages`, {
      headers: { Cookie: administratorCookie }
    });
    const payload = (await inbox.json()) as { messages?: Array<{ subject: string; fromAddress: string }> };
    const messages = payload.messages || [];
    assert.equal(messages.some((message) => message.subject === "Forged header"), false);
    assert.equal(messages.some((message) => message.subject === "Empty envelope forged"), false);
    assert.equal(messages.some((message) => message.subject === "Forged sender header"), false);
    assert.equal(messages.find((message) => message.subject === "Genuine Bea")?.fromAddress, "bea@acme.test");

    const memberSession = await fetch(`http://127.0.0.1:${listenerPort(server(), "Web", "HTTP")}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: "bea@acme.test", password: "member-horse" })
    });
    assert.equal(memberSession.status, 200);
    const memberCookie = (memberSession.headers.getSetCookie?.() || []).map((line) => line.split(";")[0]).find((line) => line.startsWith("session=")) || "";
    const sent = await fetch(`http://127.0.0.1:${listenerPort(server(), "Web", "HTTP")}/api/folders/sent/messages`, {
      headers: { Cookie: memberCookie }
    });
    const sentPayload = (await sent.json()) as { messages?: Array<{ subject: string; fromAddress: string }> };
    const sentMessages = sentPayload.messages || [];
    assert.equal(sentMessages.some((message) => message.subject === "Forged header"), false);
    assert.equal(sentMessages.find((message) => message.subject === "Genuine Bea")?.fromAddress, "bea@acme.test");
  });

  it("records the accepted message in the activity log", async () => {
    const response = await fetch(`http://127.0.0.1:${listenerPort(server(), "Web", "HTTP")}/api/activity?search=Protocol`, {
      headers: { Cookie: administratorCookie }
    });
    const payload = (await response.json()) as { events?: Array<{ subject: string }> };
    assert.equal(response.status, 200);
    assert.equal(payload.events?.some((event) => event.subject.includes("Protocol")), true);
  });
});

function listenerPort(server: RunningEmailServer, name: string, security: string): number {
  const listener = server.listeners.find((item) => item.name === name && item.security === security && item.started);
  if (!listener) {
    throw new Error(`${name} ${security} did not start`);
  }
  return listener.port;
}
