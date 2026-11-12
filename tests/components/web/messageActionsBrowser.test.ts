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

describe("mailbox message actions", () => {
  it("shows labeled reply, forward, and delete actions and uses each one", { timeout: 120000 }, async () => {
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
      const sent = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/messages",
        { to: "ada@acme.test", subject: "Please read", text: "Hello from the mailbox" },
        setup.cookieHeader
      );
      assert.equal(sent.status, 201);

      await browser.openAddress(`${consoleServer.baseUrl}/`);
      await browser.signIn("ada@acme.test", "correct-horse");
      await browser.followPath("/mailbox");
      await browser.waitUntil("The mailbox should open", (page) => page.mailboxOpen && page.pathName.startsWith("/mailbox"));
      await waitFor(browser, "The new message should be listed", `document.querySelector("[data-message]") ? "listed" : "waiting"`);
      await browser.press("[data-message]");
      const actions = await waitFor(
        browser,
        "Reply, forward, and delete should be visible",
        `(() => {
          const reply = document.querySelector("#reply-button");
          const forward = document.querySelector("#forward-button");
          const remove = document.querySelector("#delete-button");
          const subject = document.querySelector(".message-heading h2");
          if (!(reply instanceof HTMLElement) || !(forward instanceof HTMLElement) || !(remove instanceof HTMLElement) || !(subject instanceof HTMLElement)) {
            return "waiting";
          }
          const box = (element) => element.getBoundingClientRect();
          const described = (element) => ({
            text: element.innerText.replace(/\\s+/g, " ").trim(),
            height: box(element).height,
            icon: Boolean(element.querySelector("svg"))
          });
          return JSON.stringify({
            belowSubject: box(reply).top >= box(subject).bottom - 1,
            reply: described(reply),
            forward: described(forward),
            remove: described(remove)
          });
        })()`
      );
      const parsed = JSON.parse(actions) as {
        belowSubject: boolean;
        reply: { text: string; height: number; icon: boolean };
        forward: { text: string; height: number; icon: boolean };
        remove: { text: string; height: number; icon: boolean };
      };
      assert.equal(parsed.belowSubject, true);
      assert.equal(parsed.reply.text, "Reply");
      assert.equal(parsed.forward.text, "Forward");
      assert.equal(parsed.remove.text, "Delete");
      assert.ok(parsed.reply.height >= 40);
      assert.ok(parsed.forward.height >= 40);
      assert.ok(parsed.remove.height >= 40);
      assert.equal(parsed.reply.icon && parsed.forward.icon && parsed.remove.icon, true);

      await browser.press("#reply-button");
      const reply = await waitFor(
        browser,
        "Reply should address the sender",
        `(() => {
          const subject = document.querySelector("#compose-subject");
          const editor = document.querySelector("#compose-editor");
          const chip = document.querySelector("#to-field .address-chip span");
          if (!(subject instanceof HTMLInputElement) || !(editor instanceof HTMLElement) || !(chip instanceof HTMLElement)) {
            return "waiting";
          }
          return JSON.stringify({ to: chip.textContent.trim(), subject: subject.value, text: editor.innerText });
        })()`
      );
      const replyDraft = JSON.parse(reply) as { to: string; subject: string; text: string };
      assert.equal(replyDraft.to, "ada@acme.test");
      assert.equal(replyDraft.subject, "Re: Please read");
      assert.equal(replyDraft.text.includes("Hello from the mailbox"), true);
      await browser.press("#close-compose");

      await browser.press("#forward-button");
      const forward = await waitFor(
        browser,
        "Forward should quote the message without choosing a recipient",
        `(() => {
          const subject = document.querySelector("#compose-subject");
          const editor = document.querySelector("#compose-editor");
          const chip = document.querySelector("#to-field .address-chip");
          if (!(subject instanceof HTMLInputElement) || !(editor instanceof HTMLElement)) {
            return "waiting";
          }
          return JSON.stringify({ recipient: chip ? "filled" : "", subject: subject.value, text: editor.innerText });
        })()`
      );
      const forwardDraft = JSON.parse(forward) as { recipient: string; subject: string; text: string };
      assert.equal(forwardDraft.recipient, "");
      assert.equal(forwardDraft.subject, "Fwd: Please read");
      assert.equal(forwardDraft.text.includes("Forwarded message"), true);
      assert.equal(forwardDraft.text.includes("Hello from the mailbox"), true);
      assert.equal(forwardDraft.text.includes("ada@acme.test"), true);
      await browser.press("#close-compose");

      await browser.press("#delete-button");
      await waitFor(browser, "Delete should leave the inbox empty", `document.querySelector("[data-message]") ? "waiting" : "empty"`);
    } finally {
      await browser.close();
      await consoleServer.stop();
    }
  });
});
