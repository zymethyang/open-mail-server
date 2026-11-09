import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { requestJson, startWebConsole, type RunningWebConsole } from "../../support/webConsole.js";

const companyRequests: Array<{ method: string; pathName: string; body?: unknown }> = [
  { method: "GET", pathName: "/api/activity/summary" },
  { method: "GET", pathName: "/api/activity" },
  { method: "GET", pathName: "/api/activity?search=secret" },
  { method: "GET", pathName: "/api/activity/attention" },
  { method: "POST", pathName: "/api/activity/attention/reset", body: {} },
  { method: "GET", pathName: "/api/failed-email" },
  { method: "POST", pathName: "/api/failed-email/resend", body: { identifiers: [] } },
  { method: "GET", pathName: "/api/mailboxes" },
  { method: "POST", pathName: "/api/mailboxes", body: { address: "injected@acme.test", displayName: "Injected", password: "member-horse", role: "administrator" } },
  { method: "POST", pathName: "/api/mailboxes/password", body: { address: "ada@acme.test", password: "changed-horse" } },
  { method: "POST", pathName: "/api/mailboxes/access", body: { address: "ada@acme.test", disabled: true } },
  { method: "GET", pathName: "/api/settings" },
  { method: "PUT", pathName: "/api/settings", body: { publicHostname: "evil.test", relay: { enabled: true, host: "relay.evil.test", port: 587, username: "intruder", password: "intruder-horse", security: "starttls" } } },
  { method: "POST", pathName: "/api/settings", body: { publicHostname: "evil.test" } },
  { method: "PATCH", pathName: "/api/settings", body: { publicHostname: "evil.test" } },
  { method: "DELETE", pathName: "/api/settings" },
  { method: "GET", pathName: "/api/settings/export" },
  { method: "GET", pathName: "/api/certificate" },
  { method: "POST", pathName: "/api/certificate", body: { certificate: "not-a-certificate", privateKey: "not-a-key" } },
  { method: "HEAD", pathName: "/api/activity/summary" }
];

const injectedPaths = [
  "/api/../api/settings",
  "/api/folders/../settings",
  "/api/account/../../api/mailboxes",
  "/api/%2e%2e/api/certificate",
  "/api/settings%2f..%2fmailboxes",
  "/API/settings",
  "/api/settings%00"
];

describe("api access rules", () => {
  let consoleServer: RunningWebConsole;
  let administratorCookie = "";

  before(async () => {
    consoleServer = await startWebConsole();
    const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
      organizationName: "Acme",
      domain: "acme.test",
      publicAddress: "149.28.152.245",
      displayName: "Ada Admin",
      address: "ada@acme.test",
      password: "correct-horse"
    });
    assert.equal(setup.status, 201);
    administratorCookie = setup.cookieHeader;
    const created = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/mailboxes",
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

    const administrator = await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap", undefined, administratorCookie);
    assert.equal(record(administrator.payload.account).role, "administrator");
    assert.equal(record(administrator.payload.hosting).domain, "acme.test");
    assert.ok(Array.isArray(administrator.payload.listeners));

    for (const pathName of ["/api/activity/summary", "/api/activity", "/api/activity/attention", "/api/failed-email", "/api/mailboxes", "/api/settings", "/api/certificate"]) {
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
    assert.equal(JSON.stringify(bootstrap.payload).includes("zoneFile"), false);

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

    const mailboxes = await requestJson(consoleServer.baseUrl, "GET", "/api/mailboxes", undefined, administratorCookie);
    const addresses = arrayOf(mailboxes.payload.mailboxes).map((mailbox) => String(record(mailbox).address));
    assert.deepEqual(addresses.sort(), ["ada@acme.test", "bea@acme.test"]);
    const settings = await requestJson(consoleServer.baseUrl, "GET", "/api/settings", undefined, administratorCookie);
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
