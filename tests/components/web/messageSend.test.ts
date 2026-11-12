import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function messages(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(payload.messages) ? payload.messages.map(record) : [];
}

describe("sending a message", () => {
  it("explains every address problem once and still delivers mail that can be delivered", async () => {
    const consoleServer = await startWebConsole();
    try {
      const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "149.28.152.245",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      });
      assert.equal(setup.status, 201);
      const cookie = setup.cookieHeader;
      const created = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/admin/mailboxes",
        { address: "bea@acme.test", displayName: "Bea Member", password: "member-horse" },
        cookie
      );
      assert.equal(created.status, 201);
      const disabled = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/admin/mailboxes",
        { address: "cam@acme.test", displayName: "Cam Member", password: "member-horse" },
        cookie
      );
      assert.equal(disabled.status, 201);
      const turnedOff = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/mailboxes/access", { address: "cam@acme.test", disabled: true }, cookie);
      assert.equal(turnedOff.status, 200);

      const emptyRecipient = await requestJson(consoleServer.baseUrl, "POST", "/api/messages", { to: "  ", subject: "test", text: "test" }, cookie);
      assert.equal(emptyRecipient.status, 400);
      assert.equal(emptyRecipient.payload.error, "Enter at least one recipient.");

      const invalidRecipient = await requestJson(consoleServer.baseUrl, "POST", "/api/messages", { to: "not-an-address", subject: "test", text: "test" }, cookie);
      assert.equal(invalidRecipient.status, 400);
      assert.equal(invalidRecipient.payload.error, "not-an-address is not a valid email address.");

      const invalidCopy = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/messages",
        { to: "bea@acme.test", copy: "copy@", subject: "test", text: "test" },
        cookie
      );
      assert.equal(invalidCopy.status, 400);
      assert.equal(invalidCopy.payload.error, "copy@ is not a valid email address.");

      const invalidAttachment = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/messages",
        { to: "bea@acme.test", subject: "test", text: "test", attachments: ["nope"] },
        cookie
      );
      assert.equal(invalidAttachment.status, 400);
      assert.equal(invalidAttachment.payload.error, "One attachment could not be read. Remove it and try again.");

      const largeAttachment = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/messages",
        {
          to: "bea@acme.test",
          subject: "test",
          text: "test",
          attachments: [{ fileName: "big.bin", contentType: "application/octet-stream", contentEncoded: Buffer.alloc(5000).toString("base64") }]
        },
        cookie
      );
      assert.equal(largeAttachment.status, 413);
      assert.equal(largeAttachment.payload.error, "This message is too large to send.");

      const sentBefore = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/sent/messages", undefined, cookie);
      assert.equal(messages(sentBefore.payload).length, 0);
      const inboxBefore = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/inbox/messages", undefined, cookie);
      assert.equal(messages(inboxBefore.payload).length, 0);

      const missing = await requestJson(consoleServer.baseUrl, "POST", "/api/messages", { to: "admin@acme.test", subject: "Missing admin", text: "test" }, cookie);
      assert.equal(missing.status, 201);
      assert.deepEqual(missing.payload.localRecipients, []);
      const anotherMissing = await requestJson(consoleServer.baseUrl, "POST", "/api/messages", { to: "acme@acme.test", subject: "Missing company", text: "test" }, cookie);
      assert.equal(anotherMissing.status, 201);
      const several = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/messages",
        { to: "one@acme.test, two@acme.test", subject: "Missing several", text: "test" },
        cookie
      );
      assert.equal(several.status, 201);
      const copyMissing = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/messages",
        { to: "bea@acme.test", copy: "missing@acme.test", subject: "Copy missing", text: "test" },
        cookie
      );
      assert.equal(copyMissing.status, 201);
      assert.deepEqual(copyMissing.payload.localRecipients, ["bea@acme.test"]);
      const blindMissing = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/messages",
        { to: "bea@acme.test", blindCopy: "hidden@acme.test", subject: "Blind missing", text: "test" },
        cookie
      );
      assert.equal(blindMissing.status, 201);
      assert.deepEqual(blindMissing.payload.localRecipients, ["bea@acme.test"]);

      const bounced = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/inbox/messages", undefined, cookie);
      const bounceMessages = messages(bounced.payload);
      assert.equal(bounceMessages.filter((message) => message.subject === "Delivery failed").length, 5);
      const bounceText = bounceMessages.map((message) => String(message.snippet || "")).join("\n");
      assert.equal(bounceText.includes("admin@acme.test is not a mailbox on this server."), true);
      assert.equal(bounceText.includes("acme@acme.test is not a mailbox on this server."), true);
      assert.equal(bounceText.includes("one@acme.test, two@acme.test"), true);
      assert.equal(bounceText.includes("missing@acme.test is not a mailbox on this server."), true);
      assert.equal(bounceText.includes("hidden@acme.test is not a mailbox on this server."), true);

      const memberSignIn = await requestJson(consoleServer.baseUrl, "POST", "/api/session", { address: "bea@acme.test", password: "member-horse" });
      assert.equal(memberSignIn.status, 200);
      const memberInbox = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/inbox/messages", undefined, memberSignIn.cookieHeader);
      assert.equal(messages(memberInbox.payload).length, 2);

      const delivered = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/messages",
        { to: "bea@acme.test", copy: "ada@acme.test", subject: "", text: "", html: "" },
        cookie
      );
      assert.equal(delivered.status, 201);
      assert.deepEqual(delivered.payload.localRecipients, ["bea@acme.test", "ada@acme.test"]);

      const sent = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/sent/messages", undefined, cookie);
      assert.equal(messages(sent.payload).length, 6);
      const received = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/inbox/messages", undefined, memberSignIn.cookieHeader);
      assert.equal(messages(received.payload).length, 3);

      const toSelf = await requestJson(consoleServer.baseUrl, "POST", "/api/messages", { to: "Ada@acme.test", subject: "Myself", text: "Hello" }, cookie);
      assert.equal(toSelf.status, 201);
      assert.deepEqual(toSelf.payload.localRecipients, ["ada@acme.test"]);

      const toDisabled = await requestJson(consoleServer.baseUrl, "POST", "/api/messages", { to: "cam@acme.test", subject: "Still there", text: "Hello" }, cookie);
      assert.equal(toDisabled.status, 201);
      assert.deepEqual(toDisabled.payload.localRecipients, ["cam@acme.test"]);

      const started = Date.now();
      const outside = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/messages",
        { to: "person@example.test", subject: "Outside", text: "Leave now" },
        cookie
      );
      assert.equal(outside.status, 201);
      assert.ok(Date.now() - started < 1000);
      assert.deepEqual(outside.payload.queuedRecipients, ["person@example.test"]);
      assert.equal(outside.payload.warning, "");
      const waiting = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/failed-email", undefined, cookie);
      assert.equal(waiting.status, 200);
      const finished = Date.now();
      while (!consoleServer.sink.messages.some((message) => message.includes("Leave now")) && Date.now() - finished < 4000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(consoleServer.sink.messages.some((message) => message.includes("Leave now")), true);
    } finally {
      await consoleServer.stop();
    }
  });
});
