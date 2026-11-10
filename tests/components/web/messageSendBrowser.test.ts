import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConsoleBrowser } from "../../support/consoleBrowser.js";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

interface ComposerState {
  open: boolean;
  summary: string;
  fieldErrors: string[];
  colorDelta: number | null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function composerState(browser: ConsoleBrowser): Promise<ComposerState> {
  const value = await browser.script(`(() => {
    const summary = document.querySelector("#compose-summary");
    const bold = document.querySelector("#format-bold strong") || document.querySelector("#format-bold");
    const mark = document.querySelector("#format-color-mark");
    const middle = (element) => {
      if (!(element instanceof HTMLElement)) {
        return null;
      }
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return rect.top + rect.height / 2;
    };
    const boldMiddle = middle(bold);
    const markMiddle = middle(mark);
    return JSON.stringify({
      open: Boolean(document.querySelector("#compose-window")),
      summary: summary instanceof HTMLElement && !summary.hidden ? summary.innerText.replace(/\\s+/g, " ").trim() : "",
      fieldErrors: [...document.querySelectorAll(".field-error")].map((item) => item.textContent.trim()),
      colorDelta: boldMiddle === null || markMiddle === null ? null : Math.abs(boldMiddle - markMiddle)
    });
  })()`);
  if (typeof value !== "string") {
    throw new Error("The composer did not report its state");
  }
  return JSON.parse(value) as ComposerState;
}

async function waitForComposer(browser: ConsoleBrowser, description: string, ready: (state: ComposerState) => boolean): Promise<ComposerState> {
  const started = Date.now();
  let latest: ComposerState | undefined;
  while (Date.now() - started < 10000) {
    latest = await composerState(browser);
    if (ready(latest)) {
      return latest;
    }
    await delay(150);
  }
  throw new Error(`${description}. The composer was ${latest ? JSON.stringify(latest) : "unavailable"}`);
}

async function openComposer(browser: ConsoleBrowser): Promise<void> {
  await browser.press("#compose-button");
  await waitForComposer(browser, "Compose should open", (state) => state.open);
}

async function sendTo(browser: ConsoleBrowser, address: string): Promise<void> {
  const outcome = await browser.script(`(() => {
    const input = document.querySelector("#compose-to");
    const button = document.querySelector("#send-button");
    if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) {
      return "missing";
    }
    input.value = ${JSON.stringify(address)};
    button.click();
    return "sent";
  })()`);
  if (outcome !== "sent") {
    throw new Error("The composer is not ready to send");
  }
}

function messageTexts(payload: Record<string, unknown>): string[] {
  const list = Array.isArray(payload.messages) ? payload.messages : [];
  return list.map((item) => {
    const message = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return `${String(message.subject || "")}\n${String(message.snippet || "")}`;
  });
}

describe("composer send errors in the browser", () => {
  it("closes after send and keeps only a syntax error on the composer", { timeout: 120000 }, async () => {
    let releaseOutside: () => void = () => undefined;
    const outsideCanAnswer = new Promise<void>((resolve) => {
      releaseOutside = resolve;
    });
    const consoleServer = await startWebConsole({
      configuredDomain: "acme.com",
      mailExchangeResolver: (sink) => ({
        async resolve() {
          await outsideCanAnswer;
          return [{ host: "127.0.0.1", port: sink.port, trustedCertificate: sink.trustedCertificate }];
        }
      })
    });
    const browser = await ConsoleBrowser.open();
    try {
      const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
        organizationName: "Acme",
        domain: "acme.com",
        publicAddress: "149.28.152.245",
        displayName: "Ada Admin",
        address: "ada@acme.com",
        password: "correct-horse"
      });
      assert.equal(setup.status, 201);

      await browser.openAddress(`${consoleServer.baseUrl}/`);
      await browser.signIn("ada@acme.com", "correct-horse");
      await browser.followHash("#mailbox");
      await browser.waitUntil("The mailbox should open", (page) => page.mailboxOpen && page.hash === "#mailbox");

      await openComposer(browser);
      const aligned = await composerState(browser);
      assert.notEqual(aligned.colorDelta, null);
      assert.ok((aligned.colorDelta || 0) <= 1, `The color A is ${aligned.colorDelta} pixels away from Bold`);
      const toolbar = await browser.script(`(() => {
        const send = document.querySelector("#send-button");
        const bold = document.querySelector("#format-bold");
        const attach = document.querySelector("#attach-file");
        if (!(send instanceof HTMLElement) || !(bold instanceof HTMLElement) || !(attach instanceof HTMLElement)) {
          return "missing";
        }
        const sendTop = send.getBoundingClientRect().top;
        const boldTop = bold.getBoundingClientRect().top;
        const attachTop = attach.getBoundingClientRect().top;
        const afterSend = Boolean(send.compareDocumentPosition(bold) & Node.DOCUMENT_POSITION_FOLLOWING);
        return JSON.stringify({
          oneLine: Math.abs(sendTop - boldTop) <= 8 && Math.abs(sendTop - attachTop) <= 8,
          afterSend,
          sendIcon: Boolean(send.querySelector("svg")) && send.innerText.trim() === "Send"
        });
      })()`);
      assert.equal(toolbar, JSON.stringify({ oneLine: true, afterSend: true, sendIcon: true }));

      await sendTo(browser, "");
      const empty = await waitForComposer(browser, "An empty recipient should be explained once", (state) => state.summary.includes("Enter at least one recipient."));
      assert.deepEqual(empty.fieldErrors, []);
      assert.equal(empty.summary, "There is a problem Enter at least one recipient.");

      await sendTo(browser, "not-an-address");
      const invalid = await waitForComposer(browser, "An invalid address should be explained once", (state) => state.summary.includes("not a valid email address"));
      assert.deepEqual(invalid.fieldErrors, []);
      assert.equal(invalid.summary, "There is a problem not-an-address is not a valid email address.");

      await browser.script(`(() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const target = args[0] instanceof Request ? args[0].url : String(args[0]);
          if (target.includes("/api/messages")) {
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
          return originalFetch(...args);
        };
        return "delayed";
      })()`);
      await sendTo(browser, "admin@acme.com");
      const sendingStarted = Date.now();
      let sendingLabel = "";
      while (Date.now() - sendingStarted < 2000) {
        const value = await browser.script(`document.querySelector("#send-button")?.innerText.replace(/\\s+/g, " ").trim() || ""`);
        sendingLabel = typeof value === "string" ? value : "";
        if (sendingLabel === "Sending") {
          break;
        }
        await delay(20);
      }
      assert.equal(sendingLabel, "Sending");
      assert.equal(await browser.script(`document.querySelector("#send-button")?.classList.contains("is-sending") ? "shown" : ""`), "shown");
      await waitForComposer(browser, "A missing admin mailbox should close the composer", (state) => !state.open);
      assert.equal(await browser.script(`document.querySelector(".mailbox-notice") ? "shown" : ""`), "");

      await openComposer(browser);
      await sendTo(browser, "acme@acme.com");
      await waitForComposer(browser, "A missing company mailbox should close the composer", (state) => !state.open);
      assert.equal(await browser.script(`document.querySelector(".mailbox-notice") ? "shown" : ""`), "");

      await openComposer(browser);
      const outsideStarted = Date.now();
      await sendTo(browser, "zymethyang@gmail.com");
      await waitForComposer(browser, "Outside mail should close the composer before the other server answers", (state) => !state.open);
      assert.ok(Date.now() - outsideStarted < 2000);
      assert.equal(await browser.script(`document.querySelector(".mailbox-notice") ? "shown" : ""`), "");
      assert.equal(consoleServer.sink.messages.some((message) => message.includes("zymethyang@gmail.com")), false);

      const started = Date.now();
      let inboxText = "";
      while (Date.now() - started < 4000) {
        const inbox = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/inbox/messages", undefined, setup.cookieHeader);
        inboxText = messageTexts(inbox.payload).join("\n");
        if (inboxText.includes("admin@acme.com is not a mailbox on this server.") && inboxText.includes("acme@acme.com is not a mailbox on this server.")) {
          break;
        }
        await delay(50);
      }
      assert.equal(inboxText.includes("Delivery failed"), true);
      assert.equal(inboxText.includes("admin@acme.com is not a mailbox on this server."), true);
      assert.equal(inboxText.includes("acme@acme.com is not a mailbox on this server."), true);
      const sent = await requestJson(consoleServer.baseUrl, "GET", "/api/folders/sent/messages", undefined, setup.cookieHeader);
      assert.equal(Array.isArray(sent.payload.messages) ? sent.payload.messages.length : 0, 3);
    } finally {
      releaseOutside();
      await browser.close();
      await consoleServer.stop();
    }
  });
});
