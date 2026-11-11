import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

describe("address route console", () => {
  it("lets an administrator save every address kind and refuses a member", async () => {
    const consoleServer = await startWebConsole();
    try {
      const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "149.28.143.227",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      });
      assert.equal(setup.status, 201);
      const member = await requestJson(consoleServer.baseUrl, "POST", "/api/mailboxes", {
        address: "bea@acme.test",
        displayName: "Bea Member",
        password: "member-horse"
      }, setup.cookieHeader);
      assert.equal(member.status, 201);
      const memberSession = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
        address: "bea@acme.test",
        password: "member-horse"
      });
      assert.equal(memberSession.status, 200);

      const denied = await requestJson(consoleServer.baseUrl, "GET", "/api/address-routes", undefined, memberSession.cookieHeader);
      assert.equal(denied.status, 403);
      const anonymous = await requestJson(consoleServer.baseUrl, "POST", "/api/address-routes/aliases", {
        address: "sales@acme.test",
        mailboxAddress: "ada@acme.test"
      });
      assert.equal(anonymous.status, 401);

      const missingMailbox = await requestJson(consoleServer.baseUrl, "POST", "/api/address-routes/aliases", {
        address: "sales@acme.test",
        mailboxAddress: "missing@acme.test"
      }, setup.cookieHeader);
      assert.equal(missingMailbox.status, 400);
      const shadowsMailbox = await requestJson(consoleServer.baseUrl, "POST", "/api/address-routes/aliases", {
        address: "ada@acme.test",
        mailboxAddress: "bea@acme.test"
      }, setup.cookieHeader);
      assert.equal(shadowsMailbox.status, 400);

      const alias = await requestJson(consoleServer.baseUrl, "POST", "/api/address-routes/aliases", {
        address: "sales@acme.test",
        mailboxAddress: "bea@acme.test"
      }, setup.cookieHeader);
      assert.equal(alias.status, 201);
      const domain = await requestJson(consoleServer.baseUrl, "POST", "/api/address-routes/domains", { domain: "example.com" }, setup.cookieHeader);
      assert.equal(domain.status, 201);
      const list = await requestJson(consoleServer.baseUrl, "POST", "/api/address-routes/lists", {
        address: "team@example.com",
        mailboxAddresses: "ada@acme.test, bea@acme.test"
      }, setup.cookieHeader);
      assert.equal(list.status, 201);
      const catchAll = await requestJson(consoleServer.baseUrl, "POST", "/api/address-routes/catch-all", {
        domain: "example.com",
        mailboxAddress: "ada@acme.test"
      }, setup.cookieHeader);
      assert.equal(catchAll.status, 201);
      const blocked = await requestJson(consoleServer.baseUrl, "POST", "/api/address-routes/blocked", { value: "spam@bad.test" }, setup.cookieHeader);
      assert.equal(blocked.status, 201);

      const saved = await requestJson(consoleServer.baseUrl, "GET", "/api/address-routes", undefined, setup.cookieHeader);
      assert.equal(saved.status, 200);
      const routes = saved.payload.routes as { aliases: { address: string }[]; domains: string[]; lists: { address: string }[]; catchAllMailboxes: { domain: string }[]; blockedSenders: string[] };
      assert.deepEqual(routes.aliases.map((item) => item.address), ["sales@acme.test"]);
      assert.deepEqual(routes.domains, ["example.com"]);
      assert.deepEqual(routes.lists.map((item) => item.address), ["team@example.com"]);
      assert.deepEqual(routes.catchAllMailboxes.map((item) => item.domain), ["example.com"]);
      assert.deepEqual(routes.blockedSenders, ["spam@bad.test"]);

      const removed = await requestJson(consoleServer.baseUrl, "POST", "/api/address-routes/aliases", {
        remove: true,
        address: "sales@acme.test"
      }, setup.cookieHeader);
      assert.equal(removed.status, 200);
      const backup = await requestJson(consoleServer.baseUrl, "POST", "/api/backup", undefined, setup.cookieHeader);
      assert.equal(backup.status, 201);
      assert.match(String(backup.payload.backupName), /^2026-/);
    } finally {
      await consoleServer.stop();
    }
  });

  it("reports health from the listener state without a session", async () => {
    const healthy = await startWebConsole({
      listenerStatus: [{ name: "SMTP", port: 25, security: "Plain and STARTTLS", purpose: "Receive mail", started: true, detail: "" }]
    });
    const failed = await startWebConsole({
      listenerStatus: [{ name: "IMAP", port: 993, security: "TLS", purpose: "Read mail", started: false, detail: "port is already in use" }]
    });
    try {
      const up = await requestJson(healthy.baseUrl, "GET", "/health");
      assert.equal(up.status, 200);
      assert.equal(up.payload.ok, true);
      const down = await requestJson(failed.baseUrl, "GET", "/health");
      assert.equal(down.status, 503);
      assert.equal(down.payload.ok, false);
    } finally {
      await healthy.stop();
      await failed.stop();
    }
  });
});
