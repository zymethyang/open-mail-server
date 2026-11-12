import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConsoleBrowser, type ConsolePageState } from "../../support/consoleBrowser.js";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

const administratorNavigation = ["Overview", "Logs", "Failed email", "User management", "Addresses", "Settings"];
const mailboxNavigation = ["Overview", "My mailbox"];
const adminApiPaths = [
  "/api/admin/activity/summary",
  "/api/admin/activity",
  "/api/admin/activity/attention",
  "/api/admin/failed-email",
  "/api/admin/mailboxes",
  "/api/admin/settings",
  "/api/admin/certificate",
  "/api/admin/backup"
];
const retiredCompanyPaths = [
  "/api/activity/summary",
  "/api/activity",
  "/api/activity/attention",
  "/api/failed-email",
  "/api/mailboxes",
  "/api/settings",
  "/api/certificate",
  "/api/backup",
  "/api/address-routes"
];
const signedOutAddresses = [
  "",
  "/admin/overview",
  "/admin/logs",
  "/admin/failed-email",
  "/admin/users",
  "/admin/users/new",
  "/admin/users/bea@acme.test",
  "/admin/settings",
  "/admin/attention",
  "/overview",
  "/mailbox",
  "/mailbox/inbox",
  "/account",
  "#overview",
  "#mailbox",
  "#account",
  "#not-a-page"
];

describe("console access in the browser", () => {
  it("keeps the Admin portal with administrators and the mailbox with normal users", { timeout: 180000 }, async () => {
    const consoleServer = await startWebConsole();
    const browser = await ConsoleBrowser.open();
    try {
      const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "203.0.113.10",
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

      for (const address of signedOutAddresses) {
        const pageAddress = address.startsWith("#") || address === "" ? `${consoleServer.baseUrl}/${address}` : `${consoleServer.baseUrl}${address}`;
        await browser.openAddress(pageAddress);
        const page = await browser.waitUntil(`${address || "the console"} should ask for sign-in`, (state) => !state.signInHidden && state.applicationHidden);
        assertSignedOut(page, address || "/");
        assert.equal(page.signInTitle, "Acme", address || "/");
      }

      await browser.openAddress(`${consoleServer.baseUrl}/`);
      await browser.rejectSignIn("ada@acme.test", "wrong-password");
      const rejected = await browser.readPage();
      assertSignedOut(rejected, "wrong password");

      await browser.signIn("ada@acme.test", "correct-horse");
      const administrator = await browser.waitUntil(
        "An administrator should land on Overview",
        (state) => state.pathName === "/admin/overview" && state.heading === "Overview"
      );
      assert.deepEqual(administrator.navigationLabels, administratorNavigation);
      assert.equal(administrator.modeSwitchLabel, "Open mailbox");
      assert.equal(administrator.securityLabel, "Security");
      assert.equal(administrator.signOutLabel, "Sign out");
      assert.equal(administrator.accountAddress, "ada@acme.test");
      assert.equal(administrator.mailboxOpen, false);
      await browser.press("a.metric-link");
      await expectCurrent(browser, "/admin/attention", "Needs attention", false);
      await expectPage(browser, "/admin/failed-email", "Failed email", false);
      await expectPage(browser, "/admin/users", "User management", false);
      await browser.press("#add-user");
      await expectCurrent(browser, "/admin/users/new", "Add a user", false);
      await expectPage(browser, "/admin/users", "User management", false);
      await browser.press('[data-manage="bea@acme.test"]');
      const editor = await browser.waitUntil(
        "Edit should open the selected user",
        (state) => state.heading === "Edit user" && state.pathName.startsWith("/admin/users/bea")
      );
      assert.equal(editor.mailboxOpen, false);
      assert.equal(editor.applicationHidden, false);
      await expectPage(browser, "/admin/users", "User management", false);
      await expectPage(browser, "/admin/settings", "Settings", false);
      await expectPage(browser, "/admin/settings/certificate", "Settings", false);
      await browser.press("#mode-switch-button");
      await expectCurrent(browser, "/mailbox", "", true);
      const mailboxMode = await browser.readPage();
      assert.deepEqual(mailboxMode.navigationLabels, mailboxNavigation);
      assert.equal(mailboxMode.modeSwitchLabel, "Open Admin portal");
      await expectPage(browser, "/mailbox/inbox", "", true);
      await expectPage(browser, "/account", "Security", false);
      const securityFromMailbox = await browser.readPage();
      assert.deepEqual(securityFromMailbox.navigationLabels, mailboxNavigation);
      assert.equal(securityFromMailbox.modeSwitchLabel, "Open Admin portal");
      await browser.press("#mode-switch-button");
      await expectCurrent(browser, "/admin/overview", "Overview", false);
      await browser.press("#password-button");
      await expectCurrent(browser, "/account", "Security", false);
      const securityFromAdmin = await browser.readPage();
      assert.deepEqual(securityFromAdmin.navigationLabels, administratorNavigation);
      assert.equal(securityFromAdmin.modeSwitchLabel, "Open mailbox");
      await browser.followPath("/not-a-page");
      await expectCurrent(browser, "/admin/overview", "Overview", false);

      for (const label of administratorNavigation) {
        await browser.press(`#primary-navigation a[href="${navigationHref(label)}"]`);
        const page = await browser.waitUntil(
          `${label} should open from the menu`,
          (state) => state.pathName === navigationHref(label) && state.navigationLabels.join("|") === administratorNavigation.join("|")
        );
        assert.deepEqual(page.navigationLabels, administratorNavigation, label);
      }

      await browser.openAddress(`${consoleServer.baseUrl}/admin/logs`);
      await expectCurrent(browser, "/admin/logs", "Email logs", false);
      for (const pathName of adminApiPaths) {
        assert.equal(await browser.readStatus(pathName), 200, pathName);
      }
      for (const pathName of retiredCompanyPaths) {
        assert.equal(await browser.readStatus(pathName), 404, pathName);
      }
      assert.equal(await browser.readStatus("/api/folders"), 200);

      await browser.press("#password-button");
      await expectCurrent(browser, "/account", "Security", false);
      await browser.press("#sign-out-button");
      const administratorSignedOut = await browser.waitUntil(
        "Administrator sign-out should return to sign-in",
        (state) => state.applicationHidden && !state.signInHidden && state.pathName === "/"
      );
      assertSignedOut(administratorSignedOut, "administrator sign-out");

      await browser.openAddress(`${consoleServer.baseUrl}/admin/overview`);
      await browser.signIn("bea@acme.test", "member-horse");
      const member = await browser.waitUntil(
        "A normal user should see the unauthorized Admin portal state",
        (state) => state.pathName === "/admin/overview" && state.heading === "Administrator access required"
      );
      assert.deepEqual(member.navigationLabels, mailboxNavigation);
      assert.equal(member.modeSwitchLabel, "");
      assert.equal(member.securityLabel, "Security");
      assert.equal(member.signOutLabel, "Sign out");
      assert.equal(member.accountAddress, "bea@acme.test");
      assert.equal(member.mainText.includes("You cannot open the Admin portal."), true);
      assert.equal(member.mailboxOpen, false);

      const blockedPaths = [
        "/admin/overview",
        "/admin/overview/today",
        "/admin/logs",
        "/admin/logs/today",
        "/admin/failed-email",
        "/admin/users",
        "/admin/users/new",
        "/admin/users/bea@acme.test",
        "/admin/settings",
        "/admin/settings/certificate",
        "/admin/attention"
      ];
      for (const pathName of blockedPaths) {
        await browser.followPath(pathName);
        const page = await browser.waitUntil(
          `${pathName} should show unauthorized access`,
          (state) => state.pathName === pathName && state.heading === "Administrator access required" && !state.mailboxOpen
        );
        assert.deepEqual(page.navigationLabels, mailboxNavigation, pathName);
        assert.equal(page.modeSwitchLabel, "", pathName);
        assert.equal(page.accountAddress, "bea@acme.test", pathName);
        assert.equal(page.mainText.includes("Go to mailbox"), true, pathName);
      }

      await browser.press("a.primary-button");
      await expectCurrent(browser, "/mailbox", "", true);
      await browser.followPath("/not-a-page");
      await expectCurrent(browser, "/mailbox", "", true);
      await expectPage(browser, "/mailbox/inbox", "", true);
      await expectPage(browser, "/account", "Security", false);
      await browser.press("#primary-navigation a[href='/mailbox']");
      await expectCurrent(browser, "/mailbox", "", true);
      await browser.press("#password-button");
      await expectCurrent(browser, "/account", "Security", false);

      await browser.openAddress(`${consoleServer.baseUrl}/admin/settings`);
      const reloaded = await browser.waitUntil(
        "A reloaded Admin portal address should stay unauthorized for a normal user",
        (state) => state.pathName === "/admin/settings" && state.heading === "Administrator access required" && !state.applicationHidden
      );
      assert.deepEqual(reloaded.navigationLabels, mailboxNavigation);
      assert.equal(reloaded.modeSwitchLabel, "");
      for (const pathName of adminApiPaths) {
        assert.equal(await browser.readStatus(pathName), 403, pathName);
      }
      for (const pathName of retiredCompanyPaths) {
        assert.equal(await browser.readStatus(pathName), 404, pathName);
      }
      assert.equal(await browser.readStatus("/api/folders"), 200);

      await browser.followHash("#overview");
      const remapped = await browser.waitUntil(
        "A legacy admin hash should remap to an unauthorized Admin portal path",
        (state) => state.pathName === "/admin/overview" && state.heading === "Administrator access required" && state.hash === ""
      );
      assert.equal(remapped.pathName, "/admin/overview");

      await browser.press("a.primary-button");
      await expectCurrent(browser, "/mailbox", "", true);

      await browser.openAddress(`${consoleServer.baseUrl}/`);
      await expectCurrent(browser, "/mailbox", "", true);

      await browser.press("#sign-out-button");
      const memberSignedOut = await browser.waitUntil(
        "Member sign-out should return to sign-in",
        (state) => state.applicationHidden && !state.signInHidden && state.pathName === "/"
      );
      assertSignedOut(memberSignedOut, "member sign-out");
      await browser.openAddress(`${consoleServer.baseUrl}/admin/users`);
      const afterSignOut = await browser.waitUntil("An Admin portal address should stay signed out", (state) => state.applicationHidden && !state.signInHidden);
      assertSignedOut(afterSignOut, "after sign-out");
    } finally {
      await browser.close();
      await consoleServer.stop();
    }
  });
});

function navigationHref(label: string): string {
  const hrefs: Record<string, string> = {
    Overview: "/admin/overview",
    Logs: "/admin/logs",
    "Failed email": "/admin/failed-email",
    "User management": "/admin/users",
    Addresses: "/admin/addresses",
    Settings: "/admin/settings",
    "My mailbox": "/mailbox"
  };
  return hrefs[label] || "";
}

function assertSignedOut(page: ConsolePageState, label: string): void {
  assert.equal(page.applicationHidden, true, label);
  assert.equal(page.signInHidden, false, label);
  assert.equal(page.signInTitle, "Acme", label);
}

async function expectPage(browser: ConsoleBrowser, pathName: string, heading: string, mailboxOpen: boolean): Promise<void> {
  await browser.followPath(pathName);
  await expectCurrent(browser, pathName, heading, mailboxOpen);
}

async function expectCurrent(browser: ConsoleBrowser, pathName: string, heading: string, mailboxOpen: boolean): Promise<void> {
  const page = await browser.waitUntil(
    `${pathName} should show ${heading || "the mailbox"}`,
    (state) => state.pathName === pathName && state.heading === heading && state.mailboxOpen === mailboxOpen
  );
  assert.equal(page.pathName, pathName);
  assert.equal(page.heading, heading, pathName);
  assert.equal(page.mailboxOpen, mailboxOpen, pathName);
  assert.equal(page.applicationHidden, false, pathName);
  assert.equal(page.signInHidden, true, pathName);
}
