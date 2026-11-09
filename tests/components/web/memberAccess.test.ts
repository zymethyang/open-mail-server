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
        "/api/mailboxes",
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
      const companyPaths = ["/api/activity/summary", "/api/activity", "/api/activity/attention", "/api/failed-email", "/api/mailboxes", "/api/settings", "/api/certificate"];
      for (const pathName of companyPaths) {
        const response = await requestJson(consoleServer.baseUrl, "GET", pathName, undefined, cookie);
        assert.equal(response.status, 403, pathName);
      }
      const signedOut = await requestJson(consoleServer.baseUrl, "DELETE", "/api/session", undefined, cookie);
      assert.equal(signedOut.status, 200);
    } finally {
      await consoleServer.stop();
    }
  });
});
