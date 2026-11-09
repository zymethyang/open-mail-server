import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConsoleBrowser } from "../../support/consoleBrowser.js";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(browser: ConsoleBrowser, description: string, expression: string): Promise<string> {
  const started = Date.now();
  let latest = "";
  while (Date.now() - started < 10000) {
    const value = await browser.script(expression);
    latest = typeof value === "string" ? value : "";
    if (latest && latest !== "waiting") {
      return latest;
    }
    await delay(100);
  }
  throw new Error(`${description}. The page reported ${latest || "nothing"}`);
}

describe("public address", () => {
  it("shows the address from the network card on the settings page", { timeout: 120000 }, async () => {
    const consoleServer = await startWebConsole({ serverName: "mail.acme.test" });
    const browser = await ConsoleBrowser.open();
    try {
      const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
        organizationName: "Acme",
        domain: "acme.test",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      });
      assert.equal(setup.status, 201);
      await browser.openAddress(`${consoleServer.baseUrl}/`);
      await browser.signIn("ada@acme.test", "correct-horse");
      await browser.followHash("#settings");
      const text = await waitFor(
        browser,
        "The DNS records should explain the public address",
        `(() => {
          const records = document.querySelector("#dns-records");
          if (!(records instanceof HTMLElement) || !records.innerText.includes("v=spf1")) {
            return "waiting";
          }
          return records.innerText.replace(/\\s+/g, " ").trim();
        })()`
      );
      assert.equal(text.includes("reach the internet"), false);
      assert.equal(text.includes("ipify"), false);
      assert.equal(text.includes("amazonaws"), false);
      assert.equal(text.includes("Public address of this server"), false);
      assert.equal(text.includes("No network card on this server has a public address."), false);
      assert.equal(text.includes("Public address not found"), false);
      assert.equal(text.includes("<table") || text.includes("Type Name Value"), false);
      assert.match(text, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      assert.equal(text.includes("ip4:"), true);
    } finally {
      await browser.close();
      await consoleServer.stop();
    }
  });
});
