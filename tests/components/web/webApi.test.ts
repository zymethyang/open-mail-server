import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { writeJson } from "../../../src/components/jsonFile/index.js";
import { signInAttemptLimit } from "../../../src/components/signIn/constants/signInLimits.js";
import { decodeBase32, oneTimePassword } from "../../../src/components/oneTimePassword/utils/oneTimePasswordCode.js";
import { requestJson, startWebConsole, type RunningWebConsole } from "../../support/webConsole.js";

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

  async function waitForOutbound(text: string): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < 4000) {
      if (consoleServer.sink.messages.some((message) => message.includes(text))) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("serves the console and rejects setup until the company is valid", async () => {
    const home = await fetch(`${consoleServer.baseUrl}/`);
    const html = await home.text();
    assert.equal(home.status, 200);
    assert.equal(home.headers.get("x-frame-options"), "DENY");
    assert.equal(html.includes("Open Mail Server"), true);
    assert.equal(html.includes("styles/base.css"), true);
    const stylesheet = await fetch(`${consoleServer.baseUrl}/styles/base.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type") || "", /text\/css/);
    const head = await fetch(`${consoleServer.baseUrl}/`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal((await head.text()).length, 0);

    const bootstrap = await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap");
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.payload.needsSetup, true);
    assert.equal(bootstrap.payload.productName, "Open Mail Server");
    assert.equal(bootstrap.payload.account, null);

    const wrongDomain = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
      organizationName: "Acme",
      domain: "example.test",
      publicAddress: "149.28.152.245",
      displayName: "Ada Admin",
      address: "ada@example.test",
      password: "correct-horse"
    });
    assert.equal(wrongDomain.status, 400);
    const shortPassword = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
      organizationName: "Acme",
      domain: "acme.test",
      publicAddress: "149.28.152.245",
      displayName: "Ada Admin",
      address: "ada@acme.test",
      password: "short"
    });
    assert.equal(shortPassword.status, 400);
    assert.equal((await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap")).payload.needsSetup, true);

    const privateAddress = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
      organizationName: "Acme",
      domain: "acme.test",
      publicAddress: "192.168.1.20",
      displayName: "Ada Admin",
      address: "ada@acme.test",
      password: "correct-horse"
    });
    assert.equal(privateAddress.status, 400);
    assert.match(String(privateAddress.payload.error), /public IP address/);
    assert.equal((await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap")).payload.needsSetup, true);

    const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
      organizationName: "Acme",
      domain: "acme.test",
      publicAddress: "149.28.152.245",
      displayName: "Ada Admin",
      address: "ada@acme.test",
      password: "correct-horse"
    });
    assert.equal(setup.status, 201);
    assert.equal(record(setup.payload.organization).publicAddress, "149.28.152.245");
    assert.equal(record(setup.payload.organization).administratorAddress, "ada@acme.test");
    assert.equal(JSON.stringify(setup.payload).includes("passwordHash"), false);
    administratorCookie = setup.cookieHeader;
    assert.match(administratorCookie, /^session=/);
    const again = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
      organizationName: "Acme",
      domain: "acme.test",
      publicAddress: "149.28.152.245",
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
    const records = arrayOf(record(signedIn.payload.hosting).dns).map((item) => record(item));
    const addressRecord = records.find((item) => item.type === "A" || item.type === "AAAA");
    const senderPolicy = records.find((item) => String(item.value).startsWith("v=spf1"));
    const messagePolicy = records.find((item) => String(item.host).startsWith("_dmarc."));
    assert.equal(addressRecord?.value, "149.28.152.245");
    assert.equal(String(senderPolicy?.value).includes("ip4:149.28.152.245"), true);
    assert.equal(messagePolicy?.value, "v=DMARC1; p=none; rua=mailto:ada@acme.test");
    assert.equal(String(record(signedIn.payload.hosting).zoneFile).includes("network card"), false);
    const anonymous = await requestJson(consoleServer.baseUrl, "GET", "/api/folders");
    assert.equal(anonymous.status, 401);
    const folders = await requestJson(consoleServer.baseUrl, "GET", "/api/folders", undefined, administratorCookie);
    assert.equal(folders.status, 200);
    const names = arrayOf(folders.payload.folders).map((folder) => String(record(folder).storageName));
    assert.deepEqual(names, ["inbox", "sent", "drafts", "trash", "junk"]);

    const created = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/admin/mailboxes",
      { address: "bea@acme.test", displayName: "Bea Member", password: "member-horse" },
      administratorCookie
    );
    assert.equal(created.status, 201);
    const invalidMailbox = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/admin/mailboxes",
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
    const forbidden = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/mailboxes", undefined, memberCookie);
    assert.equal(forbidden.status, 403);
    const mailboxes = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/mailboxes", undefined, administratorCookie);
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
      "/api/admin/mailboxes/password",
      { address: "bea@acme.test", password: "changed-horse" },
      administratorCookie
    );
    assert.equal(replaced.status, 200);
    const oldMember = await requestJson(consoleServer.baseUrl, "GET", "/api/folders", undefined, memberCookie);
    assert.equal(oldMember.status, 401);
    const disableSelf = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/admin/mailboxes/access",
      { address: "ada@acme.test", disabled: true },
      administratorCookie
    );
    assert.equal(disableSelf.status, 400);
    const disabled = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/admin/mailboxes/access",
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
      "/api/admin/mailboxes/access",
      { address: "bea@acme.test", disabled: false },
      administratorCookie
    );
    const memberAgain = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
      address: "bea@acme.test",
      password: "changed-horse"
    });
    memberCookie = memberAgain.cookieHeader;

    const settings = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/settings", undefined, administratorCookie);
    assert.equal(record(record(settings.payload.settings).relay).passwordSaved, false);
    const invalidRelay = await requestJson(
      consoleServer.baseUrl,
      "PUT",
      "/api/admin/settings",
      { publicHostname: "", relay: { enabled: true, host: "", port: 587, username: "", password: "", security: "starttls" } },
      administratorCookie
    );
    assert.equal(invalidRelay.status, 400);
    const insecureRelay = await requestJson(
      consoleServer.baseUrl,
      "PUT",
      "/api/admin/settings",
      { publicHostname: "", relay: { enabled: false, host: "smtp.example.test", port: 25, username: "", password: "", security: "plain" } },
      administratorCookie
    );
    assert.equal(insecureRelay.status, 400);
    const saved = await requestJson(
      consoleServer.baseUrl,
      "PUT",
      "/api/admin/settings",
      {
        publicHostname: "mail.acme.test",
        relay: { enabled: false, host: "smtp.example.test", port: 465, username: "ada", password: "relay-secret", security: "tls" }
      },
      administratorCookie
    );
    assert.equal(saved.status, 200);
    assert.equal(record(record(saved.payload.settings).relay).port, 465);
    assert.equal(record(record(saved.payload.settings).relay).security, "tls");
    assert.equal(record(record(saved.payload.settings).relay).passwordSaved, true);
    assert.equal(JSON.stringify(saved.payload).includes("relay-secret"), false);
    const memberSettings = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/settings", undefined, memberCookie);
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
    assert.deepEqual(outside.payload.queuedRecipients, ["person@example.test"]);
    await waitForOutbound("Leaving the building");
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
    const crossSite = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/session",
      { address: "ada@acme.test", password: "correct-horse" },
      "",
      { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.test" }
    );
    assert.equal(crossSite.status, 403);
    const attachment = await fetch(`${consoleServer.baseUrl}/api/folders/inbox/messages/${identifier}/attachments/0`, {
      headers: { Cookie: memberCookie }
    });
    assert.equal(attachment.status, 200);
    assert.equal(attachment.headers.get("content-type"), "application/octet-stream");
    assert.match(attachment.headers.get("content-disposition") || "", /^attachment;/);
    assert.match(attachment.headers.get("content-security-policy") || "", /sandbox/);
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

  it("sends as the signed-in mailbox when the request names another mailbox", async () => {
    const forged = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/messages",
      {
        to: "ada@acme.test",
        subject: "Claimed identity",
        text: "This body asks to look like Ada",
        from: "ada@acme.test",
        fromAddress: "ada@acme.test",
        fromName: "Ada Admin",
        sender: "ada@acme.test"
      },
      memberCookie
    );
    assert.equal(forged.status, 201);
    const administratorInbox = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/inbox/messages?search=Claimed", undefined, administratorCookie);
    const delivered = record(arrayOf(administratorInbox.payload.messages)[0]);
    assert.equal(delivered.subject, "Claimed identity");
    assert.equal(delivered.fromAddress, "bea@acme.test");
    assert.equal(delivered.fromName, "Bea Member");
    const memberSent = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/sent/messages?search=Claimed", undefined, memberCookie);
    assert.equal(record(arrayOf(memberSent.payload.messages)[0]).fromAddress, "bea@acme.test");
    const administratorSent = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/sent/messages?search=Claimed", undefined, administratorCookie);
    assert.equal(arrayOf(administratorSent.payload.messages).length, 0);

    const forgedDraft = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/drafts",
      { to: "ada@acme.test", subject: "Draft identity", text: "Not sent", fromAddress: "ada@acme.test", fromName: "Ada Admin" },
      memberCookie
    );
    assert.equal(forgedDraft.status, 201);
    assert.equal(record(forgedDraft.payload.message).fromAddress, "bea@acme.test");
    assert.equal(record(forgedDraft.payload.message).fromName, "Bea Member");
  });

  it("keeps each mailbox private to the signed-in user", async () => {
    const memberMessage = await consoleServer.messageRepository.appendMessage(
      "bea@acme.test",
      "inbox",
      privateMessage("ada@acme.test", "bea@acme.test", "Only for Bea", "Bea private body")
    );
    const administratorMessage = await consoleServer.messageRepository.appendMessage(
      "ada@acme.test",
      "inbox",
      privateMessage("bea@acme.test", "ada@acme.test", "Only for Ada", "Ada private body")
    );

    const administratorSearch = await requestJson(
      consoleServer.baseUrl,
      "GET",
      "/api/folders/inbox/messages?search=Only%20for%20Bea&address=bea@acme.test",
      undefined,
      administratorCookie
    );
    assert.equal(administratorSearch.status, 200);
    assert.equal(JSON.stringify(administratorSearch.payload).includes("Bea private body"), false);
    assert.equal(arrayOf(administratorSearch.payload.messages).length, 0);

    const memberSearch = await requestJson(
      consoleServer.baseUrl,
      "GET",
      "/api/folders/inbox/messages?search=Only%20for%20Ada",
      undefined,
      memberCookie
    );
    assert.equal(memberSearch.status, 200);
    assert.equal(JSON.stringify(memberSearch.payload).includes("Ada private body"), false);
    assert.equal(arrayOf(memberSearch.payload.messages).length, 0);

    const administratorOpen = await requestJson(
      consoleServer.baseUrl,
      "GET",
      `/api/folders/inbox/messages/${memberMessage.identifier}`,
      undefined,
      administratorCookie
    );
    assert.equal(administratorOpen.status, 404);
    const memberOpen = await requestJson(
      consoleServer.baseUrl,
      "GET",
      `/api/folders/inbox/messages/${administratorMessage.identifier}`,
      undefined,
      memberCookie
    );
    assert.equal(memberOpen.status, 404);

    const administratorAttachment = await requestJson(
      consoleServer.baseUrl,
      "GET",
      `/api/folders/inbox/messages/${memberMessage.identifier}/attachments/0`,
      undefined,
      administratorCookie
    );
    assert.equal(administratorAttachment.status, 404);
    const administratorChange = await requestJson(
      consoleServer.baseUrl,
      "PATCH",
      `/api/folders/inbox/messages/${memberMessage.identifier}`,
      { seen: true },
      administratorCookie
    );
    assert.equal(administratorChange.status, 404);
    const memberDelete = await requestJson(
      consoleServer.baseUrl,
      "DELETE",
      `/api/folders/inbox/messages/${administratorMessage.identifier}`,
      undefined,
      memberCookie
    );
    assert.equal(memberDelete.status, 404);

    const crossedFolder = await requestJson(
      consoleServer.baseUrl,
      "GET",
      `/api/folders/${encodeURIComponent("../bea@acme.test/inbox")}/messages`,
      undefined,
      administratorCookie
    );
    assert.equal(crossedFolder.status, 404);
    const namedMailbox = await requestJson(
      consoleServer.baseUrl,
      "GET",
      "/api/admin/mailboxes/bea@acme.test/messages",
      undefined,
      administratorCookie
    );
    assert.equal(namedMailbox.status, 404);

    const memberInbox = await requestJson(
      consoleServer.baseUrl,
      "GET",
      "/api/folders/inbox/messages?search=Only%20for%20Bea",
      undefined,
      memberCookie
    );
    assert.equal(record(arrayOf(memberInbox.payload.messages)[0]).text, undefined);
    const memberRead = await requestJson(
      consoleServer.baseUrl,
      "GET",
      `/api/folders/inbox/messages/${memberMessage.identifier}`,
      undefined,
      memberCookie
    );
    assert.equal(record(memberRead.payload.message).text, "Bea private body");
    const administratorInbox = await requestJson(
      consoleServer.baseUrl,
      "GET",
      `/api/folders/inbox/messages/${administratorMessage.identifier}`,
      undefined,
      administratorCookie
    );
    assert.equal(record(administratorInbox.payload.message).text, "Ada private body");
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
    const summary = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/activity/summary", undefined, administratorCookie);
    assert.equal(summary.status, 200);
    assert.equal(Array.isArray(summary.payload.days), true);
    const memberSummary = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/activity/summary", undefined, memberCookie);
    assert.equal(memberSummary.status, 403);
    const events = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/activity?search=Protocol", undefined, administratorCookie);
    assert.equal(events.status, 200);
    assert.equal(arrayOf(events.payload.events).length > 0, true);
  });

  it("delivers carbon copies and blind copies without revealing the blind copy", async () => {
    const createdCopy = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/admin/mailboxes",
      { address: "cy@acme.test", displayName: "Cy Copy", password: "copy-horse" },
      administratorCookie
    );
    assert.equal(createdCopy.status, 201);
    const createdBlind = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/admin/mailboxes",
      { address: "dee@acme.test", displayName: "Dee Hidden", password: "blind-horse" },
      administratorCookie
    );
    assert.equal(createdBlind.status, 201);
    const copySignIn = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
      address: "cy@acme.test",
      password: "copy-horse"
    });
    const blindSignIn = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
      address: "dee@acme.test",
      password: "blind-horse"
    });
    assert.equal(copySignIn.status, 200);
    assert.equal(blindSignIn.status, 200);

    const invalidBlind = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/messages",
      { to: "cy@acme.test", copy: "dee@acme.test", blindCopy: "not-an-address", subject: "Bad blind copy", text: "Hi" },
      administratorCookie
    );
    assert.equal(invalidBlind.status, 400);
    const missingTo = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/messages",
      { to: "", copy: "cy@acme.test", blindCopy: "dee@acme.test", subject: "Only copies", text: "Hi" },
      administratorCookie
    );
    assert.equal(missingTo.status, 400);

    const recipientsBefore = consoleServer.sink.envelopeRecipients.length;
    const sent = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/messages",
      {
        to: "cy@acme.test, person@example.test",
        copy: "dee@acme.test, second@example.test",
        blindCopy: "bea@acme.test, hidden@example.test",
        subject: "Copies and hidden copies",
        text: "Everyone who should receive this can read it."
      },
      administratorCookie
    );
    assert.equal(sent.status, 201);
    assert.deepEqual([...(sent.payload.localRecipients as string[])].sort(), ["bea@acme.test", "cy@acme.test", "dee@acme.test"]);
    assert.deepEqual([...(sent.payload.externalRecipients as string[])].sort(), ["hidden@example.test", "person@example.test", "second@example.test"]);
    await waitForOutbound("Copies and hidden copies");
    const envelope = consoleServer.sink.envelopeRecipients.slice(recipientsBefore).join("\n").toLowerCase();
    assert.equal(envelope.includes("person@example.test"), true);
    assert.equal(envelope.includes("second@example.test"), true);
    assert.equal(envelope.includes("hidden@example.test"), true);
    const outbound = consoleServer.sink.messages.find((message) => message.includes("Copies and hidden copies")) || "";
    assert.equal(outbound.toLowerCase().includes("bcc:"), false);
    assert.equal(outbound.toLowerCase().includes("cc:"), true);
    assert.equal(outbound.toLowerCase().includes("dee@acme.test"), true);
    assert.equal(outbound.toLowerCase().includes("hidden@example.test"), false);

    async function inboxCopies(cookie: string): Promise<string[]> {
      const list = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/inbox/messages?search=Copies%20and%20hidden", undefined, cookie);
      assert.equal(list.status, 200);
      assert.equal(arrayOf(list.payload.messages).length, 1);
      return arrayOf(record(arrayOf(list.payload.messages)[0]).copyAddresses).map(String);
    }
    const expectedCopies = ["dee@acme.test", "second@example.test"];
    assert.deepEqual(await inboxCopies(copySignIn.cookieHeader), expectedCopies);
    assert.deepEqual(await inboxCopies(blindSignIn.cookieHeader), expectedCopies);
    assert.deepEqual(await inboxCopies(memberCookie), expectedCopies);
    const sentFolder = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/sent/messages?search=Copies%20and%20hidden", undefined, administratorCookie);
    assert.equal(arrayOf(sentFolder.payload.messages).length, 1);
    assert.deepEqual(arrayOf(record(arrayOf(sentFolder.payload.messages)[0]).copyAddresses).map(String), expectedCopies);

    const duplicate = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/messages",
      { to: "cy@acme.test", copy: "cy@acme.test", blindCopy: "cy@acme.test", subject: "One mailbox once", text: "Do not duplicate." },
      administratorCookie
    );
    assert.equal(duplicate.status, 201);
    assert.deepEqual(duplicate.payload.localRecipients, ["cy@acme.test"]);
    const once = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/inbox/messages?search=One%20mailbox%20once", undefined, copySignIn.cookieHeader);
    assert.equal(arrayOf(once.payload.messages).length, 1);

    const draft = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/drafts",
      { to: "cy@acme.test", copy: "dee@acme.test", subject: "Draft copies", text: "Keep the copy" },
      administratorCookie
    );
    assert.equal(draft.status, 201);
    assert.deepEqual(arrayOf(record(draft.payload.message).copyAddresses).map(String), ["dee@acme.test"]);
  });

  it("lists failed email and resends the selection or every waiting message", async () => {
    const unsigned = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/failed-email");
    assert.equal(unsigned.status, 401);
    const unsignedResend = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/failed-email/resend", { identifiers: [] });
    assert.equal(unsignedResend.status, 401);
    const forbidden = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/failed-email", undefined, memberCookie);
    assert.equal(forbidden.status, 403);
    const forbiddenResend = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/failed-email/resend", { identifiers: [] }, memberCookie);
    assert.equal(forbiddenResend.status, 403);
    const malformed = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/failed-email/resend", { identifiers: "all" }, administratorCookie);
    assert.equal(malformed.status, 400);
    const missingList = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/failed-email/resend", {}, administratorCookie);
    assert.equal(missingList.status, 400);

    const queueDirectory = path.join(consoleServer.storageDirectory, "outbound-queue");
    const firstIdentifier = "webfailure00000001";
    const secondIdentifier = "webfailure00000002";
    await writeJson(path.join(queueDirectory, `${firstIdentifier}.json`), queuedWebFailure(firstIdentifier, "one@example.test", "Web first failure"));
    await writeJson(path.join(queueDirectory, `${secondIdentifier}.json`), queuedWebFailure(secondIdentifier, "two@example.test", "Web second failure"));

    const listed = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/failed-email", undefined, administratorCookie);
    assert.equal(listed.status, 200);
    const messages = arrayOf(listed.payload.messages).map((message) => record(message));
    assert.deepEqual(messages.map((message) => String(message.subject)).sort(), ["Web first failure", "Web second failure"]);
    assert.equal(JSON.stringify(listed.payload).includes("rawEncoded"), false);

    const before = consoleServer.sink.messages.length;
    const selected = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/admin/failed-email/resend",
      { identifiers: [` ${firstIdentifier} `, firstIdentifier] },
      administratorCookie
    );
    assert.equal(selected.status, 200);
    assert.deepEqual(selected.payload.sent, [firstIdentifier]);
    assert.equal(consoleServer.sink.messages.slice(before).filter((message) => message.includes("Web first failure")).length, 1);
    assert.deepEqual(arrayOf(selected.payload.stillWaiting).map((message) => String(record(message).identifier)), [secondIdentifier]);
    assert.equal(consoleServer.sink.messages.slice(before).some((message) => message.includes("Web first failure")), true);
    assert.equal(consoleServer.sink.messages.slice(before).some((message) => message.includes("Web second failure")), false);

    const missing = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/admin/failed-email/resend",
      { identifiers: ["missing-message"] },
      administratorCookie
    );
    assert.equal(missing.status, 404);
    const remaining = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/failed-email", undefined, administratorCookie);
    assert.equal(arrayOf(remaining.payload.messages).length, 1);

    const everyMessage = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/failed-email/resend", { identifiers: [] }, administratorCookie);
    assert.equal(everyMessage.status, 200);
    assert.deepEqual(everyMessage.payload.sent, [secondIdentifier]);
    assert.deepEqual(everyMessage.payload.stillWaiting, []);
    assert.equal(consoleServer.sink.messages.some((message) => message.includes("Web second failure")), true);
    const empty = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/failed-email", undefined, administratorCookie);
    assert.deepEqual(empty.payload.messages, []);
  });
});

function queuedWebFailure(identifier: string, recipient: string, subject: string) {
  return {
    identifier,
    serverDomain: "acme.test",
    senderAddress: "ada@acme.test",
    authenticatedAddress: "ada@acme.test",
    recipientAddresses: [recipient],
    rawEncoded: Buffer.from(`From: ada@acme.test\r\nTo: ${recipient}\r\nSubject: ${subject}\r\n\r\nPlease retry\r\n`).toString("base64"),
    attempts: 1,
    nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    lastError: "The other mail server is down"
  };
}

function privateMessage(fromAddress: string, toAddress: string, subject: string, text: string) {
  return {
    fromName: fromAddress,
    fromAddress,
    toAddresses: [toAddress],
    copyAddresses: [],
    subject,
    text,
    html: "",
    date: new Date().toISOString(),
    messageIdentifierHeader: `<${subject.replace(/\s/g, "-")}@acme.test>`,
    inReplyTo: "",
    seen: false,
    answered: false,
    flagged: false,
    deleted: false,
    draft: false,
    rawEncoded: "",
    rawSize: text.length,
    attachments: []
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
