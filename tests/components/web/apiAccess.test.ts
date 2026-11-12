import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { requestJson, startWebConsole, type RunningWebConsole } from "../../support/webConsole.js";

const companyRequests: Array<{ method: string; pathName: string; body?: unknown }> = [
  { method: "GET", pathName: "/api/admin/activity/summary" },
  { method: "GET", pathName: "/api/admin/activity" },
  { method: "GET", pathName: "/api/admin/activity?search=secret" },
  { method: "GET", pathName: "/api/admin/activity/attention" },
  { method: "POST", pathName: "/api/admin/activity/attention/reset", body: {} },
  { method: "GET", pathName: "/api/admin/failed-email" },
  { method: "POST", pathName: "/api/admin/failed-email/resend", body: { identifiers: [] } },
  { method: "GET", pathName: "/api/admin/mailboxes" },
  { method: "POST", pathName: "/api/admin/mailboxes", body: { address: "injected@acme.test", displayName: "Injected", password: "member-horse", role: "administrator" } },
  { method: "POST", pathName: "/api/admin/mailboxes/password", body: { address: "ada@acme.test", password: "changed-horse" } },
  { method: "POST", pathName: "/api/admin/mailboxes/access", body: { address: "ada@acme.test", disabled: true } },
  { method: "GET", pathName: "/api/admin/settings" },
  { method: "PUT", pathName: "/api/admin/settings", body: { publicHostname: "evil.test", relay: { enabled: true, host: "relay.evil.test", port: 587, username: "intruder", password: "intruder-horse", security: "starttls" } } },
  { method: "POST", pathName: "/api/admin/settings", body: { publicHostname: "evil.test" } },
  { method: "PATCH", pathName: "/api/admin/settings", body: { publicHostname: "evil.test" } },
  { method: "DELETE", pathName: "/api/admin/settings" },
  { method: "GET", pathName: "/api/admin/settings/export" },
  { method: "GET", pathName: "/api/admin/certificate" },
  { method: "POST", pathName: "/api/admin/certificate", body: { certificate: "not-a-certificate", privateKey: "not-a-key" } },
  { method: "HEAD", pathName: "/api/admin/activity/summary" }
];

const injectedPaths = [
  "/api/../api/admin/settings",
  "/api/folders/../admin/settings",
  "/api/account/../../api/admin/mailboxes",
  "/api/%2e%2e/api/admin/certificate",
  "/api/admin/settings%2f..%2fmailboxes",
  "/API/admin/settings",
  "/api/admin/settings%00"
];

const retiredCompanyPaths = [
  "/api/activity",
  "/api/activity/summary",
  "/api/activity/attention",
  "/api/failed-email",
  "/api/failed-email/resend",
  "/api/mailboxes",
  "/api/mailboxes/password",
  "/api/address-routes",
  "/api/settings",
  "/api/certificate",
  "/api/backup"
];

describe("api access rules", () => {
  let consoleServer: RunningWebConsole;
  let administratorCookie = "";

  before(async () => {
    consoleServer = await startWebConsole();
    const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
      organizationName: "Acme",
      domain: "acme.test",
      publicAddress: "203.0.113.10",
      displayName: "Ada Admin",
      address: "ada@acme.test",
      password: "correct-horse"
    });
    assert.equal(setup.status, 201);
    administratorCookie = setup.cookieHeader;
    const created = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/admin/mailboxes",
      { address: "bea@acme.test", displayName: "Bea Member", password: "member-horse", role: "administrator" },
      administratorCookie
    );
    assert.equal(created.status, 201);
    assert.equal(record(created.payload.account).role, "member");
  });

  after(async () => {
    await consoleServer.stop();
  });

  it("gives an administrator the company routes and keeps hosting off the sign-in page", async () => {
    const anonymous = await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap");
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.payload.account, null);
    assert.equal(anonymous.payload.hosting, null);
    assert.deepEqual(anonymous.payload.listeners, []);
    assert.equal(record(anonymous.payload.organization).domain, "acme.test");
    assert.equal(record(anonymous.payload.organization).displayName, "Acme");
    assert.equal(Object.prototype.hasOwnProperty.call(anonymous.payload.organization, "publicAddress"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(anonymous.payload.organization, "administratorAddress"), false);
    assert.equal(JSON.stringify(anonymous.payload).includes("publicAddress"), false);
    assert.equal(JSON.stringify(anonymous.payload).includes("administratorAddress"), false);
    assert.equal(JSON.stringify(anonymous.payload).includes("zoneFile"), false);

    const administrator = await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap", undefined, administratorCookie);
    assert.equal(record(administrator.payload.account).role, "administrator");
    assert.equal(record(administrator.payload.hosting).domain, "acme.test");
    assert.ok(Array.isArray(administrator.payload.listeners));
    assert.equal(record(administrator.payload.organization).publicAddress, "203.0.113.10");
    assert.equal(record(administrator.payload.organization).administratorAddress, "ada@acme.test");

    for (const pathName of ["/api/admin/activity/summary", "/api/admin/activity", "/api/admin/activity/attention", "/api/admin/failed-email", "/api/admin/mailboxes", "/api/admin/settings", "/api/admin/certificate"]) {
      const response = await requestJson(consoleServer.baseUrl, "GET", pathName, undefined, administratorCookie);
      assert.equal(response.status, 200, pathName);
    }
  });

  it("lets a normal user use the mailbox, security, and sign-out only", async () => {
    const memberCookie = await memberSession(consoleServer);
    const bootstrap = await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap", undefined, memberCookie);
    assert.equal(bootstrap.status, 200);
    assert.equal(record(bootstrap.payload.account).role, "member");
    assert.equal(bootstrap.payload.hosting, null);
    assert.deepEqual(bootstrap.payload.listeners, []);
    assert.equal(record(bootstrap.payload.organization).domain, "acme.test");
    assert.equal(record(bootstrap.payload.organization).displayName, "Acme");
    assert.equal(Object.prototype.hasOwnProperty.call(bootstrap.payload.organization, "publicAddress"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(bootstrap.payload.organization, "administratorAddress"), false);
    assert.equal(JSON.stringify(bootstrap.payload).includes("publicAddress"), false);
    assert.equal(JSON.stringify(bootstrap.payload).includes("administratorAddress"), false);
    assert.equal(JSON.stringify(bootstrap.payload).includes("zoneFile"), false);
    const mailClient = await requestJson(consoleServer.baseUrl, "GET", "/api/mail-client-settings", undefined, memberCookie);
    assert.equal(mailClient.status, 200);
    assert.ok(record(mailClient.payload.clients).incomingHost);
    assert.equal(JSON.stringify(mailClient.payload).includes("zoneFile"), false);
    assert.equal(JSON.stringify(mailClient.payload).includes("dns"), false);

    const mailbox = await requestJson(consoleServer.baseUrl, "GET", "/api/folders", undefined, memberCookie);
    assert.equal(mailbox.status, 200);
    const wrongPassword = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/account/password",
      { currentPassword: "wrong-password", password: "member-horse" },
      memberCookie
    );
    assert.equal(wrongPassword.status, 401);
    const authenticator = await requestJson(consoleServer.baseUrl, "POST", "/api/account/one-time-password", {}, memberCookie);
    assert.equal(authenticator.status, 200);
    const draft = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/drafts",
      { to: "", copy: "", subject: "Note", text: "Hello", html: "" },
      memberCookie
    );
    assert.equal(draft.status, 201);
    const signedOut = await requestJson(consoleServer.baseUrl, "DELETE", "/api/session", undefined, memberCookie);
    assert.equal(signedOut.status, 200);
    const afterSignOut = await requestJson(consoleServer.baseUrl, "GET", "/api/folders", undefined, memberCookie);
    assert.equal(afterSignOut.status, 401);
  });

  it("rejects company routes, alternate methods, and injected paths for a normal user", async () => {
    const memberCookie = await memberSession(consoleServer);
    for (const companyRequest of companyRequests) {
      const response = await requestJson(
        consoleServer.baseUrl,
        companyRequest.method,
        companyRequest.pathName,
        companyRequest.body,
        memberCookie
      );
      assert.equal(response.status, 403, `${companyRequest.method} ${companyRequest.pathName}`);
      if (companyRequest.method !== "HEAD") {
        assert.equal(response.payload.error, "Administrator access is required", `${companyRequest.method} ${companyRequest.pathName}`);
      }
    }

    for (const pathName of injectedPaths) {
      const response = await rawRequest(consoleServer.baseUrl, "GET", pathName, memberCookie);
      assert.notEqual(response.status, 200, pathName);
      assert.equal(response.text.includes("publicHostname"), false, pathName);
      assert.equal(response.text.includes("privateKey"), false, pathName);
      assert.equal(response.text.includes("\"mailboxes\""), false, pathName);
    }

    const mailboxes = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/mailboxes", undefined, administratorCookie);
    const addresses = arrayOf(mailboxes.payload.mailboxes).map((mailbox) => String(record(mailbox).address));
    assert.deepEqual(addresses.sort(), ["ada@acme.test", "bea@acme.test"]);
    const settings = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/settings", undefined, administratorCookie);
    assert.equal(record(settings.payload.settings).publicHostname, "");
    assert.equal(record(record(settings.payload.settings).relay).enabled, false);
    const administrator = await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap", undefined, administratorCookie);
    assert.equal(record(administrator.payload.account).role, "administrator");
    assert.equal(record(administrator.payload.account).disabled, false);
  });

  it("rejects mailbox and company routes when nobody is signed in", async () => {
    for (const companyRequest of companyRequests) {
      const response = await requestJson(consoleServer.baseUrl, companyRequest.method, companyRequest.pathName, companyRequest.body);
      assert.equal(response.status, 401, `${companyRequest.method} ${companyRequest.pathName}`);
    }
    const mailbox = await requestJson(consoleServer.baseUrl, "GET", "/api/folders");
    assert.equal(mailbox.status, 401);
    const password = await requestJson(consoleServer.baseUrl, "POST", "/api/account/password", {
      currentPassword: "member-horse",
      password: "another-horse"
    });
    assert.equal(password.status, 401);
    for (const pathName of injectedPaths) {
      const response = await rawRequest(consoleServer.baseUrl, "GET", pathName, "");
      assert.notEqual(response.status, 200, pathName);
      assert.equal(response.text.includes("publicHostname"), false, pathName);
    }
  });

  it("returns not found for retired company API paths", async () => {
    const memberCookie = await memberSession(consoleServer);
    for (const pathName of retiredCompanyPaths) {
      const anonymous = await requestJson(consoleServer.baseUrl, "GET", pathName);
      assert.equal(anonymous.status, 404, `anonymous ${pathName}`);
      const member = await requestJson(consoleServer.baseUrl, "GET", pathName, undefined, memberCookie);
      assert.equal(member.status, 404, `member ${pathName}`);
      const administrator = await requestJson(consoleServer.baseUrl, "GET", pathName, undefined, administratorCookie);
      assert.equal(administrator.status, 404, `administrator ${pathName}`);
    }
  });
});

async function memberSession(consoleServer: RunningWebConsole): Promise<string> {
  const member = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
    address: "bea@acme.test",
    password: "member-horse",
    role: "administrator"
  });
  assert.equal(member.status, 200);
  assert.equal(record(member.payload.account).role, "member");
  return member.cookieHeader;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rawRequest(baseUrl: string, method: string, pathName: string, cookieHeader: string): Promise<{ status: number; text: string }> {
  const target = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        method,
        path: pathName,
        headers: {
          Host: target.host,
          Cookie: cookieHeader,
          "Content-Type": "application/json"
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    request.on("error", reject);
    request.end();
  });
}
