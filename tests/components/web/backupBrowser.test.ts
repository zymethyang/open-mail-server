import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBackupStamp } from "../../../src/components/backup/index.js";
import { ConsoleBrowser } from "../../support/consoleBrowser.js";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(
  browser: ConsoleBrowser,
  description: string,
  expression: string,
  timeoutMilliseconds = 20000
): Promise<string> {
  const started = Date.now();
  let latest = "";
  while (Date.now() - started < timeoutMilliseconds) {
    const value = await browser.script(expression);
    latest = typeof value === "string" ? value : "";
    if (latest && latest !== "waiting") {
      return latest;
    }
    await delay(100);
  }
  throw new Error(`${description}. The page reported ${latest || "nothing"}`);
}

describe("backup settings in the browser", () => {
  it("shows local backup times, approved restore copy, and the restore reconnect cycle", { timeout: 180000 }, async () => {
    let restartRequested = 0;
    const consoleServer = await startWebConsole({
      requestProcessRestart() {
        restartRequested += 1;
      }
    });
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
      const seeded = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/backup", undefined, setup.cookieHeader);
      assert.equal(seeded.status, 201);
      const seededName = String(seeded.payload.backupName);
      assert.ok(parseBackupStamp(seededName));

      await browser.openAddress(`${consoleServer.baseUrl}/`);
      await browser.signIn("ada@acme.test", "correct-horse");
      await browser.followPath("/admin/settings");
      const backupFoldState = await waitFor(
        browser,
        "The Backup fold should start closed",
        `(() => {
          const fold = document.querySelector("#settings-backup");
          if (!(fold instanceof HTMLDetailsElement)) {
            return "waiting";
          }
          return fold.open ? "open" : "closed";
        })()`
      );
      assert.equal(backupFoldState, "closed");
      await browser.script(`(() => {
        const fold = document.querySelector("#settings-backup");
        if (fold instanceof HTMLDetailsElement) {
          fold.open = true;
        }
      })()`);
      const hint = await waitFor(
        browser,
        "The Backup card should show the restore hint",
        `(() => {
          const card = document.querySelector("#backup-card");
          if (!(card instanceof HTMLElement)) {
            return "waiting";
          }
          const hintText = [...card.querySelectorAll("p.hint")].map((node) => node.textContent.trim()).join("\\n");
          return hintText || "waiting";
        })()`
      );
      assert.equal(hint, "Restore replaces the mail store and storage key. The server restarts briefly to finish.");

      const expectedLabel = String(
        await browser.script(`(() => {
          const stamp = ${JSON.stringify(seededName)};
          const match = /^(\\d{4}-\\d{2}-\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})-(\\d{3})Z$/.exec(stamp);
          if (!match) {
            return "";
          }
          const parsed = Date.parse(match[1] + "T" + match[2] + ":" + match[3] + ":" + match[4] + "." + match[5] + "Z");
          return new Date(parsed).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
        })()`)
      );
      assert.ok(expectedLabel);
      assert.notEqual(expectedLabel, seededName);

      const listState = await waitFor(
        browser,
        "The backup list should use UTC values and local labels",
        `(() => {
          const input = document.querySelector('input[name="backup-selection"]');
          const label = document.querySelector('label[for="backup-selection-0"]');
          if (!(input instanceof HTMLInputElement) || !(label instanceof HTMLLabelElement)) {
            return "waiting";
          }
          return JSON.stringify({ value: input.value, text: label.textContent.trim() });
        })()`
      );
      const listed = JSON.parse(listState) as { value: string; text: string };
      assert.equal(listed.value, seededName);
      assert.equal(listed.text.includes(expectedLabel), true);
      assert.equal(listed.text.includes(seededName), false);

      const idleActions = await waitFor(
        browser,
        "Delete and Restore should start disabled until a backup is selected",
        `(() => {
          const deleteButton = document.querySelector("#delete-backup");
          const restoreButton = document.querySelector("#restore-backup");
          if (!(deleteButton instanceof HTMLButtonElement) || !(restoreButton instanceof HTMLButtonElement)) {
            return "waiting";
          }
          return JSON.stringify({
            deleteDisabled: deleteButton.disabled,
            restoreDisabled: restoreButton.disabled,
            deleteClass: deleteButton.className,
            restoreClass: restoreButton.className
          });
        })()`
      );
      const idleState = JSON.parse(idleActions) as {
        deleteDisabled: boolean;
        restoreDisabled: boolean;
        deleteClass: string;
        restoreClass: string;
      };
      assert.equal(idleState.deleteDisabled, true);
      assert.equal(idleState.restoreDisabled, true);
      assert.equal(idleState.deleteClass.includes("danger-button"), true);
      assert.equal(idleState.restoreClass.includes("caution-button"), true);
      assert.equal(idleState.restoreClass.includes("danger-button"), false);
      assert.equal(idleState.restoreClass.includes("primary-button"), false);

      await browser.press("#backup-selection-0");
      const selectedActions = await waitFor(
        browser,
        "Selecting a backup should enable Delete and Restore together",
        `(() => {
          const deleteButton = document.querySelector("#delete-backup");
          const restoreButton = document.querySelector("#restore-backup");
          if (!(deleteButton instanceof HTMLButtonElement) || !(restoreButton instanceof HTMLButtonElement)) {
            return "waiting";
          }
          if (deleteButton.disabled || restoreButton.disabled) {
            return "waiting";
          }
          return "ready";
        })()`
      );
      assert.equal(selectedActions, "ready");

      await browser.press("#create-backup");
      const createdNotice = await waitFor(
        browser,
        "Creating a backup should show a local-time success notice",
        `(() => {
          const summary = document.querySelector("#backup-summary");
          if (!(summary instanceof HTMLElement) || summary.hidden || !summary.innerText.includes("Backup created")) {
            return "waiting";
          }
          return summary.innerText.replace(/\\s+/g, " ").trim();
        })()`
      );
      assert.match(createdNotice, /^Backup created Saved as /);
      assert.equal(createdNotice.includes("T"), false);
      assert.equal(/Restart the server/i.test(createdNotice), false);

      const afterCreate = await waitFor(
        browser,
        "The backup list should refresh with local-time labels",
        `(() => {
          const inputs = [...document.querySelectorAll('input[name="backup-selection"]')];
          if (inputs.length < 2) {
            return "waiting";
          }
          const labels = inputs.map((input, index) => {
            const label = document.querySelector('label[for="backup-selection-' + index + '"]');
            const value = input instanceof HTMLInputElement ? input.value : "";
            const text = label instanceof HTMLLabelElement ? label.textContent.trim() : "";
            const match = /^(\\d{4}-\\d{2}-\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})-(\\d{3})Z$/.exec(value);
            const parsed = match
              ? Date.parse(match[1] + "T" + match[2] + ":" + match[3] + ":" + match[4] + "." + match[5] + "Z")
              : Number.NaN;
            const local = Number.isNaN(parsed)
              ? ""
              : new Date(parsed).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
            return { value, text, local };
          });
          return JSON.stringify(labels);
        })()`
      );
      const refreshed = JSON.parse(afterCreate) as { value: string; text: string; local: string }[];
      for (const entry of refreshed) {
        assert.match(entry.value, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
        assert.ok(entry.local);
        assert.equal(entry.text.includes(entry.local), true);
        assert.equal(entry.text.includes(entry.value), false);
      }

      const newestIndex = refreshed.length - 1;
      await browser.press(`#backup-selection-${newestIndex}`);
      await browser.press("#restore-backup");
      const dialogBody = await waitFor(
        browser,
        "The restore dialog should show the approved body copy",
        `(() => {
          const dialog = document.querySelector("#backup-restore-dialog");
          if (!(dialog instanceof HTMLDialogElement) || !dialog.open) {
            return "waiting";
          }
          const body = dialog.querySelector("p");
          return body instanceof HTMLElement ? body.textContent.trim() : "waiting";
        })()`
      );
      assert.equal(
        dialogBody,
        "This replaces the mail store and storage key. The server restarts briefly; the console reconnects when it is ready."
      );
      assert.equal(/restart the server manually/i.test(dialogBody), false);

      await browser.press("#backup-restore-confirm");
      const restoring = await waitFor(
        browser,
        "Confirming restore should show Restoring…",
        `(() => {
          const summary = document.querySelector("#backup-summary");
          if (!(summary instanceof HTMLElement) || summary.hidden || !summary.innerText.includes("Restoring")) {
            return "waiting";
          }
          const createButton = document.querySelector("#create-backup");
          const restoreButton = document.querySelector("#restore-backup");
          const deleteButton = document.querySelector("#delete-backup");
          const radios = [...document.querySelectorAll('input[name="backup-selection"]')];
          return JSON.stringify({
            text: summary.innerText.replace(/\\s+/g, " ").trim(),
            createDisabled: createButton instanceof HTMLButtonElement ? createButton.disabled : null,
            restoreDisabled: restoreButton instanceof HTMLButtonElement ? restoreButton.disabled : null,
            deleteDisabled: deleteButton instanceof HTMLButtonElement ? deleteButton.disabled : null,
            radiosDisabled: radios.every((input) => input instanceof HTMLInputElement && input.disabled)
          });
        })()`
      );
      const restoringState = JSON.parse(restoring) as {
        text: string;
        createDisabled: boolean;
        restoreDisabled: boolean;
        deleteDisabled: boolean;
        radiosDisabled: boolean;
      };
      assert.equal(restoringState.text, "Restoring… Replacing the mail store and storage key.");
      assert.equal(restoringState.createDisabled, true);
      assert.equal(restoringState.restoreDisabled, true);
      assert.equal(restoringState.deleteDisabled, true);
      assert.equal(restoringState.radiosDisabled, true);

      const reconnecting = await waitFor(
        browser,
        "Restore should move to Reconnecting…",
        `(() => {
          const summary = document.querySelector("#backup-summary");
          if (!(summary instanceof HTMLElement) || summary.hidden || !summary.innerText.includes("Reconnecting")) {
            return "waiting";
          }
          return summary.innerText.replace(/\\s+/g, " ").trim();
        })()`
      );
      assert.equal(reconnecting, "Reconnecting… Waiting for the server to come back.");

      const restored = await waitFor(
        browser,
        "Restore should finish with Backup restored",
        `(() => {
          const summary = document.querySelector("#backup-summary");
          if (!(summary instanceof HTMLElement) || summary.hidden || !summary.innerText.includes("Backup restored")) {
            return "waiting";
          }
          const createButton = document.querySelector("#create-backup");
          return JSON.stringify({
            text: summary.innerText.replace(/\\s+/g, " ").trim(),
            createDisabled: createButton instanceof HTMLButtonElement ? createButton.disabled : null
          });
        })()`,
        45000
      );
      const restoredState = JSON.parse(restored) as { text: string; createDisabled: boolean };
      assert.equal(restoredState.text, "Backup restored The mail store and storage key are in place again.");
      assert.equal(restoredState.createDisabled, false);
      assert.equal(/Restart the server/i.test(restoredState.text), false);
      await delay(50);
      assert.equal(restartRequested, 1);
    } finally {
      await browser.close();
      await consoleServer.stop();
    }
  });

  it("deletes one selected backup after confirmation without restarting", { timeout: 180000 }, async () => {
    let restartRequested = 0;
    const consoleServer = await startWebConsole({
      requestProcessRestart() {
        restartRequested += 1;
      }
    });
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
      const first = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/backup", undefined, setup.cookieHeader);
      assert.equal(first.status, 201);
      const firstName = String(first.payload.backupName);
      const second = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/backup", undefined, setup.cookieHeader);
      assert.equal(second.status, 201);
      const secondName = String(second.payload.backupName);

      await browser.openAddress(`${consoleServer.baseUrl}/`);
      await browser.signIn("ada@acme.test", "correct-horse");
      await browser.followPath("/admin/settings");
      await waitFor(
        browser,
        "The Backup fold should be present",
        `(() => {
          const fold = document.querySelector("#settings-backup");
          if (!(fold instanceof HTMLDetailsElement)) {
            return "waiting";
          }
          fold.open = true;
          return "ready";
        })()`
      );
      await waitFor(
        browser,
        "Both backups should appear",
        `(() => {
          const inputs = [...document.querySelectorAll('input[name="backup-selection"]')];
          return inputs.length >= 2 ? "ready" : "waiting";
        })()`
      );
      const expectedLabel = String(
        await browser.script(`(() => {
          const stamp = ${JSON.stringify(firstName)};
          const match = /^(\\d{4}-\\d{2}-\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})-(\\d{3})Z$/.exec(stamp);
          if (!match) {
            return "";
          }
          const parsed = Date.parse(match[1] + "T" + match[2] + ":" + match[3] + ":" + match[4] + "." + match[5] + "Z");
          return new Date(parsed).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
        })()`)
      );
      assert.ok(expectedLabel);
      await browser.press(`input[name="backup-selection"][value=${JSON.stringify(firstName)}]`);
      await browser.press("#delete-backup");
      const dialogBody = await waitFor(
        browser,
        "The delete dialog should show the approved body copy",
        `(() => {
          const dialog = document.querySelector("#backup-delete-dialog");
          if (!(dialog instanceof HTMLDialogElement) || !dialog.open) {
            return "waiting";
          }
          const title = document.querySelector("#backup-delete-dialog-title");
          const body = dialog.querySelector("p");
          return JSON.stringify({
            title: title instanceof HTMLElement ? title.textContent.trim() : "",
            body: body instanceof HTMLElement ? body.textContent.trim() : ""
          });
        })()`
      );
      const dialogState = JSON.parse(dialogBody) as { title: string; body: string };
      assert.equal(dialogState.title, "Delete this backup?");
      assert.equal(
        dialogState.body,
        "This permanently removes the selected server backup. The live mail store is not changed."
      );
      await browser.press("#backup-delete-cancel");
      const stillListed = await waitFor(
        browser,
        "Cancel should leave both backups listed",
        `(() => {
          const values = [...document.querySelectorAll('input[name="backup-selection"]')].map((input) =>
            input instanceof HTMLInputElement ? input.value : ""
          );
          return values.includes(${JSON.stringify(firstName)}) && values.includes(${JSON.stringify(secondName)})
            ? "ready"
            : "waiting";
        })()`
      );
      assert.equal(stillListed, "ready");

      await browser.press(`input[name="backup-selection"][value=${JSON.stringify(firstName)}]`);
      await browser.press("#delete-backup");
      await browser.press("#backup-delete-confirm");
      const deletedNotice = await waitFor(
        browser,
        "Confirming delete should show Backup deleted without reconnecting",
        `(() => {
          const summary = document.querySelector("#backup-summary");
          if (!(summary instanceof HTMLElement) || summary.hidden || !summary.innerText.includes("Backup deleted")) {
            return "waiting";
          }
          if (summary.innerText.includes("Reconnecting") || summary.innerText.includes("Restoring")) {
            return "waiting";
          }
          const values = [...document.querySelectorAll('input[name="backup-selection"]')].map((input) =>
            input instanceof HTMLInputElement ? input.value : ""
          );
          const deleteButton = document.querySelector("#delete-backup");
          const restoreButton = document.querySelector("#restore-backup");
          return JSON.stringify({
            text: summary.innerText.replace(/\\s+/g, " ").trim(),
            values,
            deleteDisabled: deleteButton instanceof HTMLButtonElement ? deleteButton.disabled : null,
            restoreDisabled: restoreButton instanceof HTMLButtonElement ? restoreButton.disabled : null
          });
        })()`
      );
      const deletedState = JSON.parse(deletedNotice) as {
        text: string;
        values: string[];
        deleteDisabled: boolean;
        restoreDisabled: boolean;
      };
      assert.equal(deletedState.text, `Backup deleted Removed ${expectedLabel}.`);
      assert.deepEqual(deletedState.values, [secondName]);
      assert.equal(deletedState.deleteDisabled, true);
      assert.equal(deletedState.restoreDisabled, true);
      await delay(50);
      assert.equal(restartRequested, 0);
    } finally {
      await browser.close();
      await consoleServer.stop();
    }
  });

  it("still shows Backup restored when the restored backup predates the current session", { timeout: 180000 }, async () => {
    const consoleServer = await startWebConsole({
      requestProcessRestart() {
        return;
      }
    });
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
      const older = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/backup", undefined, setup.cookieHeader);
      assert.equal(older.status, 201);
      const olderName = String(older.payload.backupName);

      await browser.openAddress(`${consoleServer.baseUrl}/`);
      await browser.signIn("ada@acme.test", "correct-horse");
      await browser.followPath("/admin/settings");
      await waitFor(
        browser,
        "The Backup fold should be present",
        `(() => {
          const fold = document.querySelector("#settings-backup");
          if (!(fold instanceof HTMLDetailsElement)) {
            return "waiting";
          }
          fold.open = true;
          return "ready";
        })()`
      );
      await waitFor(
        browser,
        "The older backup should appear in the list",
        `(() => {
          const input = document.querySelector('input[name="backup-selection"][value=${JSON.stringify(olderName)}]');
          return input instanceof HTMLInputElement ? "ready" : "waiting";
        })()`
      );
      await browser.press(`input[name="backup-selection"][value=${JSON.stringify(olderName)}]`);
      await browser.press("#restore-backup");
      await browser.press("#backup-restore-confirm");
      const outcome = await waitFor(
        browser,
        "Restoring an older backup should finish with Backup restored",
        `(() => {
          const summary = document.querySelector("#backup-summary");
          if (!(summary instanceof HTMLElement) || summary.hidden) {
            return "waiting";
          }
          const text = summary.innerText.replace(/\\s+/g, " ").trim();
          if (text.includes("Restoring") || text.includes("Reconnecting")) {
            return "waiting";
          }
          return text;
        })()`,
        45000
      );
      assert.equal(
        outcome,
        "Backup restored The mail store and storage key are in place again.",
        "AC6 requires Backup restored after reconnect even when the restored backup predates the current browser session"
      );
    } finally {
      await browser.close();
      await consoleServer.stop();
    }
  });
});
