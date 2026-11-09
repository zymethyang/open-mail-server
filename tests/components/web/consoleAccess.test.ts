import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

const access = await import(pathToFileURL(path.join(process.cwd(), "dist/web/client/session/consoleAccess.js")).href);

describe("console access", () => {
  it("gives administrators the company pages and their own mailbox", () => {
    assert.deepEqual(
      access.navigationEntries("administrator").map((item: { label: string }) => item.label),
      ["Overview", "Logs", "Failed email", "User management", "Settings", "My mailbox"]
    );
    assert.equal(access.canOpenRoute("overview", "administrator"), true);
    assert.equal(access.canOpenRoute("logs", "administrator"), true);
    assert.equal(access.canOpenRoute("failed-email", "administrator"), true);
    assert.equal(access.canOpenRoute("users/ada@acme.test", "administrator"), true);
    assert.equal(access.canOpenRoute("settings", "administrator"), true);
    assert.equal(access.canOpenRoute("attention", "administrator"), true);
    assert.equal(access.canOpenRoute("mailbox", "administrator"), true);
    assert.equal(access.canOpenRoute("account", "administrator"), true);
    assert.equal(access.homeHash("administrator"), "#overview");
  });

  it("gives a normal user the mailbox and security page only", () => {
    assert.deepEqual(
      access.navigationEntries("member").map((item: { label: string }) => item.label),
      ["My mailbox"]
    );
    assert.equal(access.canOpenRoute("mailbox", "member"), true);
    assert.equal(access.canOpenRoute("mailbox/inbox", "member"), true);
    assert.equal(access.canOpenRoute("account", "member"), true);
    assert.equal(access.canOpenRoute("overview", "member"), false);
    assert.equal(access.canOpenRoute("logs", "member"), false);
    assert.equal(access.canOpenRoute("failed-email", "member"), false);
    assert.equal(access.canOpenRoute("users", "member"), false);
    assert.equal(access.canOpenRoute("settings", "member"), false);
    assert.equal(access.canOpenRoute("attention", "member"), false);
    assert.equal(access.homeHash("member"), "#mailbox");
  });
});
