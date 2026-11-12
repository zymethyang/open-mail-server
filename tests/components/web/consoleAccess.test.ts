import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

const access = await import(pathToFileURL(path.join(process.cwd(), "dist/web/client/session/consoleAccess.js")).href);

describe("console access", () => {
  it("gives administrators the Admin portal catalog without My mailbox", () => {
    assert.deepEqual(
      access.navigationEntries("administrator", "admin").map((item: { label: string }) => item.label),
      ["Overview", "Logs", "Failed email", "User management", "Addresses", "Settings"]
    );
    assert.deepEqual(
      access.navigationEntries("administrator", "admin").map((item: { href: string }) => item.href),
      ["/admin/overview", "/admin/logs", "/admin/failed-email", "/admin/users", "/admin/addresses", "/admin/settings"]
    );
    assert.equal(access.canOpenRoute("/admin/overview", "administrator"), true);
    assert.equal(access.canOpenRoute("/admin/logs", "administrator"), true);
    assert.equal(access.canOpenRoute("/admin/failed-email", "administrator"), true);
    assert.equal(access.canOpenRoute("/admin/users/ada@acme.test", "administrator"), true);
    assert.equal(access.canOpenRoute("/admin/addresses", "administrator"), true);
    assert.equal(access.canOpenRoute("/admin/settings", "administrator"), true);
    assert.equal(access.canOpenRoute("/admin/attention", "administrator"), true);
    assert.equal(access.canOpenRoute("/mailbox", "administrator"), true);
    assert.equal(access.canOpenRoute("/account", "administrator"), true);
    assert.equal(access.homePath("administrator"), "/admin/overview");
    assert.deepEqual(
      access.navigationEntries("administrator", "mailbox").map((item: { label: string }) => item.label),
      ["Overview", "My mailbox"]
    );
    assert.deepEqual(
      access.navigationEntries("administrator", "mailbox").map((item: { href: string }) => item.href),
      ["/overview", "/mailbox"]
    );
    assert.equal(access.canOpenRoute("/overview", "administrator"), true);
    assert.equal(access.shellModeForPath("/overview", "administrator", "admin"), "mailbox");
  });

  it("gives a normal user Overview and My mailbox", () => {
    assert.deepEqual(
      access.navigationEntries("member", "mailbox").map((item: { label: string }) => item.label),
      ["Overview", "My mailbox"]
    );
    assert.deepEqual(
      access.navigationEntries("member", "mailbox").map((item: { href: string }) => item.href),
      ["/overview", "/mailbox"]
    );
    assert.equal(access.canOpenRoute("/overview", "member"), true);
    assert.equal(access.canOpenRoute("/mailbox", "member"), true);
    assert.equal(access.canOpenRoute("/mailbox/inbox", "member"), true);
    assert.equal(access.canOpenRoute("/account", "member"), true);
    assert.equal(access.canOpenRoute("/admin/overview", "member"), false);
    assert.equal(access.canOpenRoute("/admin/logs", "member"), false);
    assert.equal(access.canOpenRoute("/admin/failed-email", "member"), false);
    assert.equal(access.canOpenRoute("/admin/users", "member"), false);
    assert.equal(access.canOpenRoute("/admin/settings", "member"), false);
    assert.equal(access.canOpenRoute("/admin/attention", "member"), false);
    assert.equal(access.homePath("member"), "/mailbox");
  });

  it("maps legacy hash bookmarks to Admin portal and mailbox paths", () => {
    assert.equal(access.mapHashToPath("#overview"), "/admin/overview");
    assert.equal(access.mapHashToPath("#overview/today"), "/admin/overview/today");
    assert.equal(access.mapHashToPath("#logs"), "/admin/logs");
    assert.equal(access.mapHashToPath("#failed-email"), "/admin/failed-email");
    assert.equal(access.mapHashToPath("#users"), "/admin/users");
    assert.equal(access.mapHashToPath("#users/new"), "/admin/users/new");
    assert.equal(access.mapHashToPath("#users/bea@acme.test"), "/admin/users/bea@acme.test");
    assert.equal(access.mapHashToPath("#mailboxes"), "/admin/users");
    assert.equal(access.mapHashToPath("#addresses"), "/admin/addresses");
    assert.equal(access.mapHashToPath("#settings"), "/admin/settings");
    assert.equal(access.mapHashToPath("#settings/certificate"), "/admin/settings/certificate");
    assert.equal(access.mapHashToPath("#attention"), "/admin/attention");
    assert.equal(access.mapHashToPath("#mailbox"), "/mailbox");
    assert.equal(access.mapHashToPath("#mailbox/inbox"), "/mailbox/inbox");
    assert.equal(access.mapHashToPath("#account"), "/account");
    assert.equal(access.mapHashToPath("#not-a-page"), null);
  });
});
