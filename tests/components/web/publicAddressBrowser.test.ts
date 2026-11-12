import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConsoleBrowser } from "../../support/consoleBrowser.js";
import { startWebConsole } from "../../support/webConsole.js";

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

async function submitSetup(browser: ConsoleBrowser, publicAddress: string): Promise<void> {
  const outcome = await waitFor(
    browser,
    "The setup form should be ready",
    `(() => {
      const form = document.querySelector("#setup-form");
      const organization = document.querySelector("#setup-organization");
      const domain = document.querySelector("#setup-domain");
      const publicAddressField = document.querySelector("#setup-public-address");
      const name = document.querySelector("#setup-name");
      const address = document.querySelector("#setup-address");
      const password = document.querySelector("#setup-password");
      if (!(form instanceof HTMLFormElement) || !(organization instanceof HTMLInputElement) || !(domain instanceof HTMLInputElement) || !(publicAddressField instanceof HTMLInputElement) || !(name instanceof HTMLInputElement) || !(address instanceof HTMLInputElement) || !(password instanceof HTMLInputElement)) {
        return "waiting";
      }
      if (domain.value !== "acme.test") {
        return "waiting";
      }
      organization.value = "Acme";
      publicAddressField.value = ${JSON.stringify(publicAddress)};
      name.value = "Ada Admin";
      address.value = "ada@acme.test";
      password.value = "correct-horse";
      form.requestSubmit();
      return "submitted";
    })()`
  );
  assert.equal(outcome, "submitted");
}

describe("public address", () => {
  it("asks for the public IP address while creating the administrator", { timeout: 120000 }, async () => {
    const consoleServer = await startWebConsole({ serverName: "mail.acme.test" });
    const browser = await ConsoleBrowser.open();
    try {
      await browser.openAddress(`${consoleServer.baseUrl}/`);
      const setupText = await waitFor(
        browser,
        "The setup form should ask for the public IP address",
        `(() => {
          const form = document.querySelector("#setup-form");
          if (!(form instanceof HTMLElement) || !form.innerText.includes("Public IP address")) {
            return "waiting";
          }
          return form.innerText.replace(/\\s+/g, " ").trim();
        })()`
      );
      assert.equal(setupText.includes("Public IP address"), true);
      assert.equal(setupText.includes("DMARC reports are sent to this address."), false);
      assert.equal(setupText.includes("network card"), false);

      await submitSetup(browser, "192.168.1.20");
      const problem = await waitFor(
        browser,
        "A private address should stay on the setup form",
        `(() => {
          const summary = document.querySelector("#setup-summary");
          const field = document.querySelector("#setup-public-address");
          if (!(summary instanceof HTMLElement) || summary.hidden || !(field instanceof HTMLInputElement) || field.getAttribute("aria-invalid") !== "true") {
            return "waiting";
          }
          return summary.innerText.replace(/\\s+/g, " ").trim();
        })()`
      );
      assert.match(problem, /public IP address/);
      assert.equal(problem.includes("network card"), false);

      await submitSetup(browser, "203.0.113.10");
      await browser.waitUntil("The administrator should land on the overview", (page) => !page.applicationHidden && page.pathName === "/admin/overview");
      await browser.followPath("/admin/settings");
      const records = await waitFor(
        browser,
        "DNS records should use the entered public IP address and administrator email",
        `(() => {
          const zone = document.querySelector("#dns-zone-file");
          if (!(zone instanceof HTMLElement) || !zone.innerText.includes("v=spf1")) {
            return "waiting";
          }
          return zone.innerText;
        })()`
      );
      assert.equal(records.includes("203.0.113.10"), true);
      assert.equal(records.includes("v=spf1 ip4:203.0.113.10 ~all"), true);
      assert.equal(records.includes("v=DMARC1; p=none; rua=mailto:ada@acme.test"), true);
      assert.equal(records.includes("admin@acme.test"), false);
      assert.equal(records.includes("192.168.1.20"), false);
      assert.equal(records.includes("network card"), false);
      const pageText = await browser.script(`document.body.innerText`);
      assert.equal(String(pageText).includes("No network card"), false);
      assert.equal(String(pageText).includes("network card"), false);
    } finally {
      await browser.close();
      await consoleServer.stop();
    }
  });
});
