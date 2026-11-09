import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startEmailServer } from "../../../src/components/emailServer/index.js";
import type { RunningEmailServer } from "../../../src/components/emailServer/interfaces/runningEmailServer.js";
import { generateAuthoritySignedCertificate } from "../../../src/components/certificate/utils/selfSignedCertificate.js";
import { connectPlain, connectTrustedTls, readResponse, upgradeToTrustedTls } from "../../support/protocolClient.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { testConfiguration } from "../../support/testConfiguration.js";

describe("certificate authority chain", { concurrency: 1 }, () => {
  let running: RunningEmailServer | undefined;
  let storageDirectory = "";
  const issued = generateAuthoritySignedCertificate(["acme.test"]);

  function server(): RunningEmailServer {
    if (!running) {
      throw new Error("The mail server did not start");
    }
    return running;
  }

  before(async () => {
    storageDirectory = await createTemporaryStorage();
    running = await startEmailServer({ configuration: testConfiguration(storageDirectory) });
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
    const cookie = sessionCookie(setup);
    const baseUrl = `http://127.0.0.1:${listenerPort(server(), "Web", "HTTP")}`;
    const missingIntermediate = await fetch(`${baseUrl}/api/certificate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ certificate: issued.certificate, privateKey: issued.privateKey })
    });
    assert.equal(missingIntermediate.status, 400);
    const uploaded = await fetch(`${baseUrl}/api/certificate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        certificate: issued.certificate,
        privateKey: issued.privateKey,
        intermediateCertificates: issued.intermediateCertificate
      })
    });
    const payload = (await uploaded.json()) as { certificate?: { selfSigned?: boolean; intermediateCount?: number } };
    assert.equal(uploaded.status, 200);
    assert.equal(payload.certificate?.selfSigned, false);
    assert.equal(payload.certificate?.intermediateCount, 1);
  });

  after(async () => {
    await running?.stop();
    if (storageDirectory) {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("lets a phone trust IMAP, SMTP, and POP3 with the provider root", async () => {
    const mailbox = await connectTrustedTls(listenerPort(server(), "IMAP", "TLS"), issued.rootCertificate, "acme.test");
    try {
      assert.match(await readResponse(mailbox), /IMAP4rev1/);
      mailbox.write("a1 LOGOUT\r\n");
      await readResponse(mailbox, { tag: "a1" });
    } finally {
      mailbox.end();
    }

    const submission = await connectTrustedTls(listenerPort(server(), "SMTP", "TLS"), issued.rootCertificate, "acme.test");
    try {
      assert.match(await readResponse(submission), /^220 /);
      submission.write("QUIT\r\n");
      await readResponse(submission);
    } finally {
      submission.end();
    }

    const startTls = await connectPlain(listenerPort(server(), "SMTP", "STARTTLS"));
    try {
      await readResponse(startTls);
      startTls.write("EHLO phone.example\r\n");
      await readResponse(startTls);
      startTls.write("STARTTLS\r\n");
      assert.match(await readResponse(startTls), /^220 /);
      const secured = await upgradeToTrustedTls(startTls, issued.rootCertificate, "acme.test");
      secured.write("EHLO phone.example\r\n");
      assert.match(await readResponse(secured), /AUTH PLAIN LOGIN/);
      secured.write("QUIT\r\n");
      await readResponse(secured);
    } finally {
      startTls.end();
    }

    const pop3 = await connectTrustedTls(listenerPort(server(), "POP3", "TLS"), issued.rootCertificate, "acme.test");
    try {
      assert.match(await readResponse(pop3), /^\+OK/);
      pop3.write("QUIT\r\n");
      await readResponse(pop3);
    } finally {
      pop3.end();
    }

    const pop3StartTls = await connectPlain(listenerPort(server(), "POP3", "Plain and STLS"));
    try {
      await readResponse(pop3StartTls);
      pop3StartTls.write("STLS\r\n");
      assert.match(await readResponse(pop3StartTls), /^\+OK/);
      const secured = await upgradeToTrustedTls(pop3StartTls, issued.rootCertificate, "acme.test");
      secured.write("CAPA\r\n");
      assert.match(await readResponse(secured, { dotTerminated: true }), /USER/);
      secured.write("QUIT\r\n");
      await readResponse(secured);
    } finally {
      pop3StartTls.end();
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

function sessionCookie(response: Response): string {
  const header = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie().join(",") : response.headers.get("set-cookie") || "";
  const match = /session=[^;]+/.exec(header);
  if (!match) {
    throw new Error("The setup response did not include a session");
  }
  return match[0];
}
