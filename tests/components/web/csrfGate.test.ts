import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { requestJson, startWebConsole, suppressCsrfAutoThread, type RunningWebConsole } from "../../support/webConsole.js";

describe("csrf token gate", () => {
  let consoleServer: RunningWebConsole;
  let administratorCookie = "";
  let csrfToken = "";

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
    const bootstrap = await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap", undefined, administratorCookie);
    assert.equal(bootstrap.status, 200);
    csrfToken = typeof bootstrap.payload.csrfToken === "string" ? bootstrap.payload.csrfToken : "";
    assert.match(csrfToken, /^[a-f0-9]{64}$/);
  });

  after(async () => {
    await consoleServer.stop();
  });

  it("rejects a mutating admin route without the token", async () => {
    const rejected = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/admin/mailboxes",
      { address: "no-token@acme.test", displayName: "No Token", password: "member-horse", role: "member" },
      administratorCookie,
      suppressCsrfAutoThread()
    );
    assert.equal(rejected.status, 403);
    assert.match(String(rejected.payload.error), /CSRF/i);
  });

  it("accepts the same mutating admin route with the correct token", async () => {
    const accepted = await requestJson(
      consoleServer.baseUrl,
      "POST",
      "/api/admin/mailboxes",
      { address: "with-token@acme.test", displayName: "With Token", password: "member-horse", role: "member" },
      administratorCookie,
      { "X-CSRF-Token": csrfToken }
    );
    assert.equal(accepted.status, 201);
    assert.match(JSON.stringify(accepted.payload), /with-token@acme\.test/i);
  });

  it("exposes the token on bootstrap when signed in and hides it when anonymous", async () => {
    const signedIn = await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap", undefined, administratorCookie);
    assert.equal(signedIn.payload.csrfToken, csrfToken);
    const anonymous = await requestJson(consoleServer.baseUrl, "GET", "/api/bootstrap");
    assert.equal(anonymous.payload.csrfToken, "");
  });
});