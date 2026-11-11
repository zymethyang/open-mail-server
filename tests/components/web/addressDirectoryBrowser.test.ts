import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConsoleBrowser } from "../../support/consoleBrowser.js";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

async function pageText(browser: ConsoleBrowser): Promise<string> {
  const text = await browser.script(`document.querySelector("#main-content")?.innerText || ""`);
  return typeof text === "string" ? text : "";
}

async function waitForText(browser: ConsoleBrowser, expected: string): Promise<string> {
  const started = Date.now();
  let latest = "";
  while (Date.now() - started < 10000) {
    latest = await pageText(browser);
    if (latest.includes(expected)) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`The page did not show ${expected}. It showed ${latest}`);
}

async function submitAddress(browser: ConsoleBrowser, kind: string, value: string, target: string): Promise<void> {
  const outcome = await browser.script(`(() => {
    const kindField = document.querySelector("#address-kind");
    const valueField = document.querySelector("#address-value");
    const targetField = document.querySelector("#address-target");
    const form = document.querySelector("#address-form");
    if (!(kindField instanceof HTMLSelectElement) || !(valueField instanceof HTMLInputElement) || !(targetField instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
      return "missing";
    }
    kindField.value = ${JSON.stringify(kind)};
    valueField.value = ${JSON.stringify(value)};
    targetField.value = ${JSON.stringify(target)};
    form.requestSubmit();
    return "submitted";
  })()`);
  assert.equal(outcome, "submitted");
}

describe("address directory in the browser", () => {
  it("lets an administrator add and remove an alias", { timeout: 180000 }, async () => {
    const consoleServer = await startWebConsole();
    const browser = await ConsoleBrowser.open();
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

      await browser.openAddress(consoleServer.baseUrl);
      await browser.signIn("ada@acme.test", "correct-horse");
      await browser.followHash("#addresses");
      await browser.waitUntil("Addresses should open for an administrator", (state) => state.hash === "#addresses" && state.heading === "Addresses");
      await waitForText(browser, "No aliases yet.");

      await submitAddress(browser, "alias", "sales@acme.test", "missing@acme.test");
      await waitForText(browser, "Mailbox missing@acme.test does not exist");

      await submitAddress(browser, "alias", "sales@acme.test", "bea@acme.test");
      await waitForText(browser, "sales@acme.test goes to bea@acme.test");

      await browser.press('[data-remove="alias"]');
      await waitForText(browser, "No aliases yet.");

      await browser.followHash("#mailbox");
      await browser.waitUntil("The mailbox should open", (state) => state.hash.startsWith("#mailbox") && state.mailboxOpen);
      const signedOut = await browser.script(`document.querySelector("#sign-out-button")?.click(); "signed-out"`);
      assert.equal(signedOut, "signed-out");
      await browser.waitUntil("Sign out should return to the gate", (state) => state.applicationHidden && !state.signInHidden);
      await browser.signIn("bea@acme.test", "member-horse");
      await browser.followHash("#addresses");
      const memberPage = await browser.waitUntil("A member should leave the address directory", (state) => state.hash.startsWith("#mailbox"));
      assert.equal(memberPage.navigationLabels.includes("Addresses"), false);
    } finally {
      await browser.close();
      await consoleServer.stop();
    }
  });
});
