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

describe("live mailbox", () => {
  it("shows a new message without reloading the page", { timeout: 120000 }, async () => {
    const consoleServer = await startWebConsole();
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
      await browser.followHash("#mailbox");
      await browser.waitUntil("The mailbox should open", (page) => page.mailboxOpen && page.hash === "#mailbox");
      await waitFor(
        browser,
        "The mailbox stream should be open",
        `document.documentElement.dataset.mailboxStream === "open" ? "open" : "waiting"`
      );
      await browser.script(`window.mailboxPageToken = "still-here"`);
      const sent = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/messages",
        { to: "ada@acme.test", subject: "Live mailbox arrival", text: "This arrived while the mailbox was open" },
        setup.cookieHeader
      );
      assert.equal(sent.status, 201);
      const listed = await waitFor(
        browser,
        "The new message should appear without a refresh",
        `(() => {
          const subjects = [...document.querySelectorAll(".message-subject")].map((item) => item.textContent.trim());
          if (!subjects.includes("Live mailbox arrival")) {
            return "waiting";
          }
          return JSON.stringify({
            subjects,
            pageToken: window.mailboxPageToken || "",
            hash: location.hash
          });
        })()`
      );
      const parsed = JSON.parse(listed) as { subjects: string[]; pageToken: string; hash: string };
      assert.equal(parsed.pageToken, "still-here");
      assert.equal(parsed.hash, "#mailbox");
      assert.equal(parsed.subjects.includes("Live mailbox arrival"), true);
    } finally {
      await browser.close();
      await consoleServer.stop();
    }
  });
});
