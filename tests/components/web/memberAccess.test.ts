import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

describe("member console access", () => {
  it("lets a normal user use the mailbox and refuses company pages", async () => {
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
      const created = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/admin/mailboxes",
        { address: "bea@acme.test", displayName: "Bea Member", password: "member-horse" },
        setup.cookieHeader
      );
      assert.equal(created.status, 201);
      const member = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
        address: "bea@acme.test",
        password: "member-horse"
      });
      assert.equal(member.status, 200);
      const cookie = member.cookieHeader;
      const mailbox = await requestJson(consoleServer.baseUrl, "GET", "/api/folders", undefined, cookie);
      assert.equal(mailbox.status, 200);
      const password = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/account/password",
        { currentPassword: "wrong-password", password: "member-horse" },
        cookie
      );
      assert.equal(password.status, 401);
      const companyPaths = [
        "/api/admin/activity/summary",
        "/api/admin/activity",
        "/api/admin/activity/attention",
        "/api/admin/failed-email",
        "/api/admin/mailboxes",
        "/api/admin/settings",
        "/api/admin/certificate",
        "/api/admin/backup"
      ];
      for (const pathName of companyPaths) {
        const response = await requestJson(consoleServer.baseUrl, "GET", pathName, undefined, cookie);
        assert.equal(response.status, 403, pathName);
        assert.equal(response.payload.error, "Administrator access is required", pathName);
      }
      const backupCreate = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/backup", undefined, cookie);
      assert.equal(backupCreate.status, 403);
      assert.equal(backupCreate.payload.error, "Administrator access is required");
      const backupRestore = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/admin/backup/restore",
        { backupName: "missing" },
        cookie
      );
      assert.equal(backupRestore.status, 403);
      assert.equal(backupRestore.payload.error, "Administrator access is required");
      const backupDelete = await requestJson(
        consoleServer.baseUrl,
        "DELETE",
        "/api/admin/backup",
        { backupName: "2026-11-11T12-00-00-000Z" },
        cookie
      );
      assert.equal(backupDelete.status, 403);
      assert.equal(backupDelete.payload.error, "Administrator access is required");
      const mailClient = await requestJson(consoleServer.baseUrl, "GET", "/api/mail-client-settings", undefined, cookie);
      assert.equal(mailClient.status, 200);
      assert.equal(JSON.stringify(mailClient.payload).includes("zoneFile"), false);
      assert.equal(JSON.stringify(mailClient.payload).includes("listeners"), false);
      assert.equal(JSON.stringify(mailClient.payload).includes("publicPorts"), false);
      assert.ok(mailClient.payload.clients);
      const retiredPaths = ["/api/activity", "/api/failed-email", "/api/mailboxes", "/api/settings", "/api/certificate", "/api/backup", "/api/address-routes"];
      for (const pathName of retiredPaths) {
        const response = await requestJson(consoleServer.baseUrl, "GET", pathName, undefined, cookie);
        assert.equal(response.status, 404, pathName);
      }
      const signedOut = await requestJson(consoleServer.baseUrl, "DELETE", "/api/session", undefined, cookie);
      assert.equal(signedOut.status, 200);
    } finally {
      await consoleServer.stop();
    }
  });
});
