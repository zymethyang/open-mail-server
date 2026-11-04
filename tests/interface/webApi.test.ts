import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { signInAttemptLimit } from "../../src/components/signIn/constants/signInLimits.js";
import { decodeBase32, oneTimePassword } from "../../src/components/oneTimePassword/utils/oneTimePasswordCode.js";
import { requestJson, startWebConsole, type RunningWebConsole } from "../support/webConsole.js";

describe("web console interface", { concurrency: 1 }, () => {
  let consoleServer: RunningWebConsole;
  let administratorCookie = "";
  let memberCookie = "";

  before(async () => {
    consoleServer = await startWebConsole();
  });

  after(async () => {
    await consoleServer.stop();
  });

  it("serves the console and rejects setup until the company is valid", async () => {
    const home = await fetch(`${consoleServer.baseUrl}/`);
    const html = await home.text();
    assert.equal(home.status, 200);
    assert.equal(home.headers.get("x-frame-options"), "DENY");
    assert.equal(html.includes("Email Server"), true);
    assert.equal(html.includes("styles.css"), true);
    const stylesheet = await fetch(`${consoleServer.baseUrl}/styles.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type") || "", /text\/css/);
    const head = await fetch(`${consoleServer.baseUrl}/`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal((await head.text()).length, 0);

    const bootstrap = await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap");
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.payload.needsSetup, true);
    assert.equal(bootstrap.payload.productName, "Email Server");
    assert.equal(bootstrap.payload.account, null);

    const wrongDomain = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
      organizationName: "Acme",
      domain: "example.test",
      displayName: "Ada Admin",
      address: "ada@example.test",
      password: "correct-horse"
    });
    assert.equal(wrongDomain.status, 400);
    const shortPassword = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
      organizationName: "Acme",
      domain: "acme.test",
      displayName: "Ada Admin",
      address: "ada@acme.test",
      password: "short"
    });
    assert.equal(shortPassword.status, 400);
    assert.equal((await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap")).payload.needsSetup, true);

    const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
      organizationName: "Acme",
      domain: "acme.test",
      displayName: "Ada Admin",
      address: "ada@acme.test",
      password: "correct-horse"
    });
    assert.equal(setup.status, 201);
    assert.equal(JSON.stringify(setup.payload).includes("passwordHash"), false);
    administratorCookie = setup.cookieHeader;
    assert.match(administratorCookie, /^session=/);
    const again = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
      organizationName: "Acme",
      domain: "acme.test",
      displayName: "Ada Admin",
      address: "ada@acme.test",
      password: "correct-horse"
    });
    assert.equal(again.status, 409);
  });

  it("requires a session for mailbox routes and an administrator for company routes", async () => {
    const signedIn = await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap", undefined, administratorCookie);
    assert.equal(record(signedIn.payload.account).address, "ada@acme.test");
    assert.equal(record(signedIn.payload.hosting).domain, "acme.test");
    const anonymous = await requestJson(consoleServer.baseUrl, "GET", "/api/folders");
    assert.equal(anonymous.status, 401);
    const folders = await requestJson(consoleServer.baseUrl, "GET", "/api/folders", undefined, administratorCookie);
    assert.equal(folders.status, 200);
    const names = arrayOf(folders.payload.folders).map((folder) => String(record(folder).storageName));
    assert.deepEqual(names, ["inbox", "sent", "drafts", "trash"]);

    const created = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/mailboxes",
      { address: "bea@acme.test", displayName: "Bea Member", password: "member-horse" },
      administratorCookie
    );
    assert.equal(created.status, 201);
    const invalidMailbox = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/mailboxes",
      { address: "bea@example.test", displayName: "Bea", password: "member-horse" },
      administratorCookie
    );
    assert.equal(invalidMailbox.status, 400);
    const memberSignIn = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
      address: "bea@acme.test",
      password: "member-horse"
    });
    assert.equal(memberSignIn.status, 200);
    memberCookie = memberSignIn.cookieHeader;
    const forbidden = await requestJson(consoleServer.baseUrl, "GET", "/api/mailboxes", undefined, memberCookie);
    assert.equal(forbidden.status, 403);
    const mailboxes = await requestJson(consoleServer.baseUrl, "GET", "/api/mailboxes", undefined, administratorCookie);
    assert.equal(arrayOf(mailboxes.payload.mailboxes).length, 2);

    const wrongPassword = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
      address: "ada@acme.test",
      password: "wrong-horse"
    });
    assert.equal(wrongPassword.status, 401);
    const signedOut = await requestJson(consoleServer.baseUrl, "DELETE", "/api/session", undefined, administratorCookie);
    assert.equal(signedOut.status, 200);
    assert.equal(signedOut.payload.signedOut, true);
    const afterSignOut = await requestJson(consoleServer.baseUrl, "GET", "/api/folders", undefined, administratorCookie);
    assert.equal(afterSignOut.status, 401);
    const restored = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
      address: "ada@acme.test",
      password: "correct-horse"
    });
    administratorCookie = restored.cookieHeader;
    assert.equal(restored.status, 200);
  });

  it("changes passwords, access, and relay settings", async () => {
    const wrongCurrent = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/account/password",
      { currentPassword: "wrong-horse", password: "another-horse" },
      administratorCookie
    );
    assert.equal(wrongCurrent.status, 401);
    const previousAdministratorCookie = administratorCookie;
    const changed = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/account/password",
      { currentPassword: "correct-horse", password: "another-horse" },
      administratorCookie
    );
    assert.equal(changed.status, 200);
    administratorCookie = changed.cookieHeader;
    const oldSession = await requestJson(consoleServer.baseUrl, "GET", "/api/folders", undefined, previousAdministratorCookie);
    assert.equal(oldSession.status, 401);

    const replaced = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/mailboxes/password",
      { address: "bea@acme.test", password: "changed-horse" },
      administratorCookie
    );
    assert.equal(replaced.status, 200);
    const oldMember = await requestJson(consoleServer.baseUrl, "GET", "/api/folders", undefined, memberCookie);
    assert.equal(oldMember.status, 401);
    const disableSelf = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/mailboxes/access",
      { address: "ada@acme.test", disabled: true },
      administratorCookie
    );
    assert.equal(disableSelf.status, 400);
    const disabled = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/mailboxes/access",
      { address: "bea@acme.test", disabled: true },
      administratorCookie
    );
    assert.equal(record(disabled.payload.account).disabled, true);
    const memberRejected = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
      address: "bea@acme.test",
      password: "changed-horse"
    });
    assert.equal(memberRejected.status, 401);
    await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/mailboxes/access",
      { address: "bea@acme.test", disabled: false },
      administratorCookie
    );
    const memberAgain = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
      address: "bea@acme.test",
      password: "changed-horse"
    });
    memberCookie = memberAgain.cookieHeader;

    const settings = await requestJson(consoleServer.baseUrl, "GET", "/api/settings", undefined, administratorCookie);
    assert.equal(record(record(settings.payload.settings).relay).passwordSaved, false);
    const invalidRelay = await requestJson(
      consoleServer.baseUrl,
      "PUT",
      "/api/settings",
      { publicHostname: "", relay: { enabled: true, host: "", port: 587, username: "", password: "", security: "starttls" } },
      administratorCookie
    );
    assert.equal(invalidRelay.status, 400);
    const saved = await requestJson(
      consoleServer.baseUrl,
      "PUT",
      "/api/settings",
      {
        publicHostname: "mail.acme.test",
        relay: { enabled: false, host: "smtp.example.test", port: 2525, username: "ada", password: "relay-secret", security: "starttls" }
      },
      administratorCookie
    );
    assert.equal(saved.status, 200);
    assert.equal(record(record(saved.payload.settings).relay).passwordSaved, true);
    assert.equal(JSON.stringify(saved.payload).includes("relay-secret"), false);
    const memberSettings = await requestJson(consoleServer.baseUrl, "GET", "/api/settings", undefined, memberCookie);
    assert.equal(memberSettings.status, 403);
  });

  it("saves drafts, delivers mail, and manages a message", async () => {
    const missingRecipient = await requestJson(consoleServer.baseUrl, "POST", "/api/messages", { to: "", subject: "Empty", text: "Hi" }, administratorCookie);
    assert.equal(missingRecipient.status, 400);
    const invalidCopy = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/messages",
      { to: "bea@acme.test", copy: "not-an-address", subject: "Copy", text: "Hi" },
      administratorCookie
    );
    assert.equal(invalidCopy.status, 400);
    const invalidAttachment = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/messages",
      { to: "bea@acme.test", subject: "Bad", text: "Hi", attachments: ["nope"] },
      administratorCookie
    );
    assert.equal(invalidAttachment.status, 400);
    const largeAttachment = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/messages",
      {
        to: "bea@acme.test",
        subject: "Large",
        text: "Hi",
        attachments: [{ fileName: "big.bin", contentType: "application/octet-stream", contentEncoded: Buffer.alloc(5000).toString("base64") }]
      },
      administratorCookie
    );
    assert.equal(largeAttachment.status, 413);

    const draft = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/drafts",
      { to: "bea@acme.test", subject: "Draft note", text: "Not sent", html: "<p>Not sent</p><script>alert(1)</script>" },
      administratorCookie
    );
    assert.equal(draft.status, 201);
    assert.equal(record(draft.payload.message).folderName, "drafts");
    const drafts = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/drafts/messages", undefined, administratorCookie);
    assert.equal(arrayOf(drafts.payload.messages).length, 1);

    const sent = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/messages",
      {
        to: "bea@acme.test",
        copy: "",
        blindCopy: "",
        subject: "Protocol check",
        text: "Hello from the console",
        html: "<p>Hello</p><script>alert(1)</script>",
        attachments: [{ fileName: "note.txt", contentType: "text/plain", contentEncoded: Buffer.from("note").toString("base64") }]
      },
      administratorCookie
    );
    assert.equal(sent.status, 201);
    assert.deepEqual(sent.payload.localRecipients, ["bea@acme.test"]);
    const outside = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/messages",
      { to: "person@example.test", subject: "Outbound", text: "Leaving the building" },
      administratorCookie
    );
    assert.equal(outside.status, 201);
    assert.equal(consoleServer.sink.messages.some((message) => message.includes("Leaving the building")), true);

    const memberInbox = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/inbox/messages?search=Protocol", undefined, memberCookie);
    assert.equal(arrayOf(memberInbox.payload.messages).length, 1);
    const summary = record(arrayOf(memberInbox.payload.messages)[0]);
    const identifier = String(summary.identifier);
    const message = await requestJson(consoleServer.baseUrl, "GET", `/api/folders/inbox/messages/${identifier}`, undefined, memberCookie);
    assert.equal(message.status, 200);
    assert.equal(record(message.payload.message).text, "Hello from the console");
    assert.equal(String(record(message.payload.message).html).includes("script"), false);
    assert.equal(record(message.payload.message).seen, true);
    const attachment = await fetch(`${consoleServer.baseUrl}/api/folders/inbox/messages/${identifier}/attachments/0`, {
      headers: { Cookie: memberCookie }
    });
    assert.equal(attachment.status, 200);
    assert.equal(await attachment.text(), "note");
    const missingAttachment = await requestJson(
      consoleServer.baseUrl,
      "GET",
      `/api/folders/inbox/messages/${identifier}/attachments/3`,
      undefined,
      memberCookie
    );
    assert.equal(missingAttachment.status, 404);

    const flagged = await requestJson(
      consoleServer.baseUrl,
      "PATCH",
      `/api/folders/inbox/messages/${identifier}`,
      { flagged: true, seen: false },
      memberCookie
    );
    assert.equal(record(flagged.payload.message).flagged, true);
    const removed = await requestJson(consoleServer.baseUrl, "DELETE", `/api/folders/inbox/messages/${identifier}`, undefined, memberCookie);
    assert.equal(removed.status, 200);
    const trash = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/trash/messages", undefined, memberCookie);
    const trashed = record(arrayOf(trash.payload.messages)[0]);
    const deleted = await requestJson(
      consoleServer.baseUrl,
      "DELETE",
      `/api/folders/trash/messages/${String(trashed.identifier)}`,
      undefined,
      memberCookie
    );
    assert.equal(deleted.status, 200);
    assert.equal(arrayOf((await requestJson(consoleServer.baseUrl, "GET", "/api/folders/trash/messages", undefined, memberCookie)).payload.messages).length, 0);

    await consoleServer.messageRepository.appendMessage("bea@acme.test", "inbox", {
      fromName: 'Ada Nguyen"',
      fromAddress: "ada@acme.test",
      toAddresses: ["bea@acme.test"],
      copyAddresses: [],
      subject: "Quoted",
      text: "Name",
      html: "",
      date: new Date().toISOString(),
      messageIdentifierHeader: "<quoted@acme.test>",
      inReplyTo: "",
      seen: false,
      answered: false,
      flagged: false,
      deleted: false,
      draft: false,
      rawEncoded: "",
      rawSize: 0,
      attachments: []
    });
    const quoted = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/inbox/messages?search=Quoted", undefined, memberCookie);
    assert.equal(record(arrayOf(quoted.payload.messages)[0]).fromName, "Ada Nguyen");
  });

  it("sets up an authenticator and blocks repeated failed sign-ins", async () => {
    const started = await requestJson(consoleServer.baseUrl, "POST", "/api/account/one-time-password", {}, administratorCookie);
    assert.equal(started.status, 200);
    const secret = String(started.payload.secret);
    assert.equal(String(started.payload.image).includes("<svg"), true);
    const wrongCode = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/account/one-time-password/confirm",
      { code: "000000" },
      administratorCookie
    );
    assert.equal(wrongCode.status, 401);
    const code = oneTimePassword(decodeBase32(secret));
    const confirmed = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/account/one-time-password/confirm",
      { code },
      administratorCookie
    );
    assert.equal(record(confirmed.payload.account).oneTimePasswordEnabled, true);
    const signedOut = await requestJson(consoleServer.baseUrl, "DELETE", "/api/session", undefined, administratorCookie);
    assert.equal(signedOut.status, 200);
    const pending = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
      address: "ada@acme.test",
      password: "another-horse"
    });
    assert.equal(pending.payload.oneTimePasswordRequired, true);
    const rejectedCode = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/session/one-time-password",
      { code: "000000" },
      pending.cookieHeader
    );
    assert.equal(rejectedCode.status, 401);
    const acceptedCode = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/session/one-time-password",
      { code },
      pending.cookieHeader
    );
    assert.equal(acceptedCode.status, 200);
    administratorCookie = acceptedCode.cookieHeader;
    const removed = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/account/one-time-password/remove",
      { password: "another-horse", code },
      administratorCookie
    );
    assert.equal(record(removed.payload.account).oneTimePasswordEnabled, false);

    for (let attempt = 0; attempt < signInAttemptLimit; attempt += 1) {
      const failed = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
        address: "missing@acme.test",
        password: "wrong-horse"
      });
      assert.equal(failed.status, 401);
    }
    const blocked = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
      address: "missing@acme.test",
      password: "wrong-horse"
    });
    assert.equal(blocked.status, 429);
  });

  it("rejects a bad request and records activity", async () => {
    const origin = await fetch(`${consoleServer.baseUrl}/api/session`, {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ address: "ada@acme.test", password: "another-horse" })
    });
    assert.equal(origin.status, 403);
    const invalid = await fetch(`${consoleServer.baseUrl}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json"
    });
    assert.equal(invalid.status, 400);
    const missing = await requestJson(consoleServer.baseUrl, "GET", "/api/missing", undefined, administratorCookie);
    assert.equal(missing.status, 404);
    const summary = await requestJson(consoleServer.baseUrl, "GET", "/api/activity/summary", undefined, administratorCookie);
    assert.equal(summary.status, 200);
    assert.equal(Array.isArray(summary.payload.days), true);
    const memberSummary = await requestJson(consoleServer.baseUrl, "GET", "/api/activity/summary", undefined, memberCookie);
    assert.equal(memberSummary.status, 403);
    const events = await requestJson(consoleServer.baseUrl, "GET", "/api/activity?search=Protocol", undefined, administratorCookie);
    assert.equal(events.status, 200);
    assert.equal(arrayOf(events.payload.events).length > 0, true);
  });
});

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
