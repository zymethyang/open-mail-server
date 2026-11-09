import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConsoleBrowser, type ConsolePageState } from "../../support/consoleBrowser.js";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

const administratorNavigation = ["Overview", "Logs", "Failed email", "User management", "Settings", "My mailbox"];
const memberNavigation = ["My mailbox"];
const companyPaths = ["/api/activity/summary", "/api/activity", "/api/activity/attention", "/api/failed-email", "/api/mailboxes", "/api/settings", "/api/certificate"];
const signedOutAddresses = [
  "",
  "#overview",
  "#logs",
  "#failed-email",
  "#users",
  "#users/new",
  "#users/bea@acme.test",
  "#mailboxes",
  "#settings",
  "#attention",
  "#mailbox",
  "#mailbox/inbox",
  "#account",
  "#not-a-page"
];

describe("console access in the browser", () => {
  it("keeps company pages with administrators and the mailbox with normal users", { timeout: 180000 }, async () => {
    const consoleServer = await startWebConsole();
    const browser = await ConsoleBrowser.open();
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

      for (const hash of signedOutAddresses) {
        await browser.openAddress(`${consoleServer.baseUrl}/${hash}`);
        const page = await browser.waitUntil(`${hash || "the console"} should ask for sign-in`, (state) => !state.signInHidden && state.applicationHidden);
        assertSignedOut(page, hash || "/");
        assert.equal(page.signInTitle, "Acme", hash || "/");
      }

      await browser.openAddress(`${consoleServer.baseUrl}/`);
      await browser.rejectSignIn("ada@acme.test", "wrong-password");
      const rejected = await browser.readPage();
      assertSignedOut(rejected, "wrong password");

      await browser.signIn("ada@acme.test", "correct-horse");
      const administrator = await browser.waitUntil("An administrator should land on Overview", (state) => state.hash === "#overview" && state.heading === "Overview");
      assert.deepEqual(administrator.navigationLabels, administratorNavigation);
      assert.equal(administrator.securityLabel, "Security");
      assert.equal(administrator.signOutLabel, "Sign out");
      assert.equal(administrator.accountAddress, "ada@acme.test");
      assert.equal(administrator.mailboxOpen, false);
      await browser.press("a.metric-link");
      await expectCurrent(browser, "#attention", "Needs attention", false);
      await expectPage(browser, "#failed-email", "Failed email", false);
      await expectPage(browser, "#users", "User management", false);
      await browser.press("#add-user");
      await expectCurrent(browser, "#users/new", "Add a user", false);
      await expectPage(browser, "#users", "User management", false);
      await browser.press('[data-manage="bea@acme.test"]');
      const editor = await browser.waitUntil("Edit should open the selected user", (state) => state.heading === "Edit user" && state.hash.startsWith("#users/bea"));
      assert.equal(editor.mailboxOpen, false);
      assert.equal(editor.applicationHidden, false);
      await expectPage(browser, "#mailboxes", "User management", false);
      await expectPage(browser, "#settings", "Settings", false);
      await expectPage(browser, "#settings/certificate", "Settings", false);
      await expectPage(browser, "#mailbox", "", true);
      await expectPage(browser, "#mailbox/inbox", "", true);
      await expectPage(browser, "#account", "Security", false);
      await browser.followHash("#not-a-page");
      await expectCurrent(browser, "#overview", "Overview", false);

      for (const label of administratorNavigation) {
        await browser.press(`#primary-navigation a[href="${navigationHref(label)}"]`);
        const page = await browser.waitUntil(`${label} should open from the menu`, (state) => state.hash === navigationHref(label) && state.navigationLabels.join("|") === administratorNavigation.join("|"));
        assert.deepEqual(page.navigationLabels, administratorNavigation, label);
      }

      await browser.openAddress(`${consoleServer.baseUrl}/#logs`);
      await expectCurrent(browser, "#logs", "Email logs", false);
      for (const pathName of companyPaths) {
        assert.equal(await browser.readStatus(pathName), 200, pathName);
      }
      assert.equal(await browser.readStatus("/api/folders"), 200);

      await browser.press("#password-button");
      await expectCurrent(browser, "#account", "Security", false);
      await browser.press("#sign-out-button");
      const administratorSignedOut = await browser.waitUntil("Administrator sign-out should return to sign-in", (state) => state.applicationHidden && !state.signInHidden && state.hash === "");
      assertSignedOut(administratorSignedOut, "administrator sign-out");

      await browser.openAddress(`${consoleServer.baseUrl}/#overview`);
      await browser.signIn("bea@acme.test", "member-horse");
      const member = await browser.waitUntil("A normal user should land on My mailbox", (state) => state.hash === "#mailbox" && state.mailboxOpen && state.heading === "");
      assert.deepEqual(member.navigationLabels, memberNavigation);
      assert.equal(member.securityLabel, "Security");
      assert.equal(member.signOutLabel, "Sign out");
      assert.equal(member.accountAddress, "bea@acme.test");

      const blockedHashes = [
        "#overview",
        "#overview/today",
        "#logs",
        "#logs/today",
        "#failed-email",
        "#users",
        "#users/new",
        "#users/bea@acme.test",
        "#mailboxes",
        "#settings",
        "#settings/certificate",
        "#attention",
        "#not-a-page"
      ];
      for (const hash of blockedHashes) {
        await browser.followHash(hash);
        const page = await browser.waitUntil(`${hash} should return a normal user to the mailbox`, (state) => state.hash === "#mailbox" && state.mailboxOpen && state.heading === "");
        assert.deepEqual(page.navigationLabels, memberNavigation, hash);
        assert.equal(page.accountAddress, "bea@acme.test", hash);
      }

      await expectPage(browser, "#mailbox/inbox", "", true);
      await expectPage(browser, "#account", "Security", false);
      await browser.press("#primary-navigation a[href='#mailbox']");
      await expectCurrent(browser, "#mailbox", "", true);
      await browser.press("#password-button");
      await expectCurrent(browser, "#account", "Security", false);

      await browser.openAddress(`${consoleServer.baseUrl}/#settings`);
      const reloaded = await browser.waitUntil("A reloaded company address should return a normal user to the mailbox", (state) => state.hash === "#mailbox" && state.mailboxOpen && !state.applicationHidden);
      assert.deepEqual(reloaded.navigationLabels, memberNavigation);
      for (const pathName of companyPaths) {
        assert.equal(await browser.readStatus(pathName), 403, pathName);
      }
      assert.equal(await browser.readStatus("/api/folders"), 200);

      await browser.press("#sign-out-button");
      const memberSignedOut = await browser.waitUntil("Member sign-out should return to sign-in", (state) => state.applicationHidden && !state.signInHidden && state.hash === "");
      assertSignedOut(memberSignedOut, "member sign-out");
      await browser.openAddress(`${consoleServer.baseUrl}/#users`);
      const afterSignOut = await browser.waitUntil("A company address should stay signed out", (state) => state.applicationHidden && !state.signInHidden);
      assertSignedOut(afterSignOut, "after sign-out");
    } finally {
      await browser.close();
      await consoleServer.stop();
    }
  });
});

function navigationHref(label: string): string {
  const hrefs: Record<string, string> = {
    Overview: "#overview",
    Logs: "#logs",
    "Failed email": "#failed-email",
    "User management": "#users",
    Settings: "#settings",
    "My mailbox": "#mailbox"
  };
  return hrefs[label] || "";
}

function assertSignedOut(page: ConsolePageState, label: string): void {
  assert.equal(page.applicationHidden, true, label);
  assert.equal(page.signInHidden, false, label);
  assert.equal(page.signInTitle, "Acme", label);
}

async function expectPage(browser: ConsoleBrowser, hash: string, heading: string, mailboxOpen: boolean): Promise<void> {
  await browser.followHash(hash);
  await expectCurrent(browser, hash, heading, mailboxOpen);
}

async function expectCurrent(browser: ConsoleBrowser, hash: string, heading: string, mailboxOpen: boolean): Promise<void> {
  const page = await browser.waitUntil(`${hash} should show ${heading || "the mailbox"}`, (state) => state.hash === hash && state.heading === heading && state.mailboxOpen === mailboxOpen);
  assert.equal(page.hash, hash);
  assert.equal(page.heading, heading, hash);
  assert.equal(page.mailboxOpen, mailboxOpen, hash);
  assert.equal(page.applicationHidden, false, hash);
  assert.equal(page.signInHidden, true, hash);
}
