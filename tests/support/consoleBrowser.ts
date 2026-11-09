import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

export interface ConsolePageState {
  hash: string;
  navigationLabels: string[];
  securityLabel: string;
  signOutLabel: string;
  applicationHidden: boolean;
  signInHidden: boolean;
  heading: string;
  mailboxOpen: boolean;
  accountAddress: string;
  signInTitle: string;
  signInError: string;
}

interface CommandResult {
  sessionId?: string;
  targetId?: string;
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

interface PendingCommand {
  resolve: (value: CommandResult) => void;
  reject: (error: Error) => void;
}

const pageStateExpression = `JSON.stringify({
  hash: location.hash,
  navigationLabels: [...document.querySelectorAll("#primary-navigation a")].map((link) => link.textContent.trim()),
  securityLabel: document.querySelector("#password-button")?.textContent.trim() || "",
  signOutLabel: document.querySelector("#sign-out-button")?.textContent.trim() || "",
  applicationHidden: document.querySelector("#application-shell") ? Boolean(document.querySelector("#application-shell").hidden) : true,
  signInHidden: document.querySelector("#sign-in-screen") ? Boolean(document.querySelector("#sign-in-screen").hidden) : true,
  heading: document.querySelector("#main-content h1")?.textContent.trim() || "",
  mailboxOpen: Boolean(document.querySelector("#mailbox-layout")),
  accountAddress: document.querySelector("#account-label")?.textContent.trim() || "",
  signInTitle: document.querySelector("#sign-in-title")?.textContent.trim() || "",
  signInError: document.querySelector("#sign-in-summary")?.textContent.trim() || ""
})`;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function chromeExecutable(): string {
  const candidates = [
    process.env.CHROME_EXECUTABLE || "",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter((candidate) => candidate.length > 0);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Google Chrome is required for the console browser test");
  }
  return found;
}

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export class ConsoleBrowser {
  private readonly socket: WebSocket;
  private readonly chromeProcess: ChildProcess;
  private readonly profileDirectory: string;
  private readonly pending = new Map<number, PendingCommand>();
  private messageId = 0;
  private sessionId = "";

  private constructor(socket: WebSocket, chromeProcess: ChildProcess, profileDirectory: string) {
    this.socket = socket;
    this.chromeProcess = chromeProcess;
    this.profileDirectory = profileDirectory;
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; error?: { message?: string }; result?: CommandResult };
      if (!message.id || !this.pending.has(message.id)) {
        return;
      }
      const waiting = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (!waiting) {
        return;
      }
      if (message.error) {
        waiting.reject(new Error(message.error.message || "Browser command failed"));
        return;
      }
      waiting.resolve(message.result || {});
    });
  }

  static async open(): Promise<ConsoleBrowser> {
    const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "email-server-browser-"));
    const port = await availablePort();
    const chromeProcess = spawn(
      chromeExecutable(),
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--ignore-certificate-errors",
        "--allow-insecure-localhost",
        `--user-data-dir=${profileDirectory}`,
        `--remote-debugging-port=${port}`,
        "about:blank"
      ],
      { stdio: "ignore" }
    );
    try {
      const version = await waitForChrome(port);
      const socket = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve());
        socket.addEventListener("error", () => reject(new Error("Chrome debugging connection failed")));
      });
      const browser = new ConsoleBrowser(socket, chromeProcess, profileDirectory);
      const target = await browser.command("Target.createTarget", { url: "about:blank" }, false);
      const attached = await browser.command("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false);
      browser.sessionId = attached.sessionId || "";
      await browser.command("Page.enable", {}, true);
      await browser.command("Runtime.enable", {}, true);
      return browser;
    } catch (error) {
      chromeProcess.kill();
      await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async openAddress(pageAddress: string): Promise<void> {
    await this.command("Page.navigate", { url: "about:blank" }, true);
    await this.waitUntil("The browser should leave the previous page", (page) => page.signInTitle === "" && page.applicationHidden && page.signInHidden);
    await this.command("Page.navigate", { url: pageAddress }, true);
    await this.waitUntil("The console should finish loading", (page) => !page.signInHidden || !page.applicationHidden);
  }

  async signIn(address: string, password: string): Promise<ConsolePageState> {
    await this.submitSignIn(address, password);
    return this.waitUntil("Sign-in should open the console", (page) => !page.applicationHidden);
  }

  async rejectSignIn(address: string, password: string): Promise<ConsolePageState> {
    await this.submitSignIn(address, password);
    return this.waitUntil(
      "A wrong password should stay on the sign-in screen",
      (page) => page.applicationHidden && page.signInError.includes("Invalid credentials")
    );
  }

  async script(expression: string, awaitPromise = false): Promise<unknown> {
    return this.evaluate(expression, awaitPromise);
  }

  async followHash(hash: string): Promise<void> {
    await this.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  }

  async press(selector: string): Promise<void> {
    const outcome = await this.evaluate(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!(target instanceof HTMLElement)) {
        return "missing";
      }
      target.click();
      return "pressed";
    })()`);
    if (outcome !== "pressed") {
      throw new Error(`The page has no ${selector}`);
    }
  }

  async readStatus(pathName: string): Promise<number> {
    const status = await this.evaluate(`fetch(${JSON.stringify(pathName)}).then((response) => response.status)`, true);
    if (typeof status !== "number") {
      throw new Error(`The page did not report a status for ${pathName}`);
    }
    return status;
  }

  async readPage(): Promise<ConsolePageState> {
    const value = await this.evaluate(pageStateExpression);
    if (typeof value !== "string") {
      throw new Error("The page did not report its state");
    }
    return JSON.parse(value) as ConsolePageState;
  }

  async waitUntil(description: string, ready: (page: ConsolePageState) => boolean): Promise<ConsolePageState> {
    const started = Date.now();
    let latest: ConsolePageState | undefined;
    while (Date.now() - started < 20000) {
      try {
        latest = await this.readPage();
        if (ready(latest)) {
          return latest;
        }
      } catch {
        latest = undefined;
      }
      await delay(200);
    }
    throw new Error(`${description}. The page was ${latest ? JSON.stringify(latest) : "still loading"}`);
  }

  async close(): Promise<void> {
    this.socket.close();
    this.chromeProcess.kill();
    await rm(this.profileDirectory, { recursive: true, force: true }).catch(() => undefined);
  }

  private async submitSignIn(address: string, password: string): Promise<void> {
    await this.waitUntil("The sign-in form should be ready", (page) => !page.signInHidden && page.signInTitle.length > 0);
    const outcome = await this.evaluate(`(() => {
      const addressField = document.querySelector("#sign-in-address");
      const passwordField = document.querySelector("#sign-in-password");
      const form = document.querySelector("#sign-in-form");
      if (!(addressField instanceof HTMLInputElement) || !(passwordField instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
        return "missing";
      }
      addressField.value = ${JSON.stringify(address)};
      passwordField.value = ${JSON.stringify(password)};
      form.requestSubmit();
      return "submitted";
    })()`);
    if (outcome !== "submitted") {
      throw new Error("The sign-in form is not ready");
    }
  }

  private async evaluate(expression: string, awaitPromise = false): Promise<unknown> {
    const result = await this.command(
      "Runtime.evaluate",
      { expression, awaitPromise, returnByValue: true },
      true
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "The page script failed");
    }
    return result.result?.value;
  }

  private command(method: string, params: Record<string, unknown>, useSession: boolean): Promise<CommandResult> {
    const id = ++this.messageId;
    const payload: Record<string, unknown> = { id, method, params };
    if (useSession) {
      payload.sessionId = this.sessionId;
    }
    this.socket.send(JSON.stringify(payload));
    const result = new Promise<CommandResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    return withTimeout(result, 20000, method);
  }
}

async function waitForChrome(port: number): Promise<{ webSocketDebuggerUrl: string }> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return (await response.json()) as { webSocketDebuggerUrl: string };
      }
    } catch {
      await delay(200);
    }
  }
  throw new Error("Chrome debugging port did not open");
}
