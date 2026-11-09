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

describe("mail authentication in the browser", () => {
  it("shows SPF, DKIM, and DMARC on the settings page", { timeout: 120000 }, async () => {
    const consoleServer = await startWebConsole({ serverName: "mail.acme.test" });
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
      await browser.openAddress(`${consoleServer.baseUrl}/`);
      await browser.signIn("ada@acme.test", "correct-horse");
      await browser.followHash("#settings");
      const text = await waitFor(
        browser,
        "The DNS records should include SPF, DKIM, and DMARC",
        `(() => {
          const records = document.querySelector("#dns-records");
          if (!(records instanceof HTMLElement) || !records.innerText.includes("v=DKIM1")) {
            return "waiting";
          }
          return records.innerText.replace(/\\s+/g, " ").trim();
        })()`
      );
      assert.equal(text.includes("SPF uses soft fail"), false);
      assert.equal(text.includes("Public address of this server"), false);
      assert.equal(text.includes("No network card on this server has a public address."), false);
      assert.equal(text.includes("Public address not found"), false);
      assert.equal(text.includes("v=spf1"), true);
      assert.equal(text.includes("~all"), true);
      assert.equal(text.includes("-all"), false);
      assert.equal(text.includes("ip4:"), true);
      assert.equal(text.includes("mail._domainkey.acme.test"), true);
      assert.equal(text.includes("v=DKIM1"), true);
      assert.equal(text.includes("_dmarc.acme.test"), true);
      assert.equal(text.includes("149.28.152.245"), true);
      assert.equal(text.includes("v=spf1 ip4:149.28.152.245 ~all"), true);
      assert.equal(text.includes("v=DMARC1; p=none; rua=mailto:ada@acme.test"), true);
      assert.equal(text.includes("network card"), false);
    } finally {
      await browser.close();
      await consoleServer.stop();
    }
  });
});
