import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { parseBackupStamp } from "../../../src/components/backup/index.js";

const settingsClientPath = path.join(process.cwd(), "src/web/client/components/settings/index.ts");
const baseStylesPath = path.join(process.cwd(), "src/web/styles/base.css");

describe("backup presentation", () => {
  it("turns UTC backup folder stamps into human-readable local times", () => {
    const stamp = "2026-11-12T04-50-39-447Z";
    const createdAt = parseBackupStamp(stamp);
    assert.ok(createdAt);
    const label = createdAt.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    assert.notEqual(label, stamp);
    assert.equal(label.includes("T04-50"), false);
    assert.equal(/^\d{4}-\d{2}-\d{2}T/.test(label), false);
    assert.match(label, /\d/);
  });

  it("keeps the approved Backup card copy and omits manual restart instructions", async () => {
    const source = await readFile(settingsClientPath, "utf8");
    assert.equal(
      source.includes("Restore replaces the mail store and storage key. The server restarts briefly to finish."),
      true
    );
    assert.equal(
      source.includes(
        "This replaces the mail store and storage key. The server restarts briefly; the console reconnects when it is ready."
      ),
      true
    );
    assert.equal(source.includes("<h2>Restoring…</h2><p>Replacing the mail store and storage key.</p>"), true);
    assert.equal(source.includes("<h2>Reconnecting…</h2><p>Waiting for the server to come back.</p>"), true);
    assert.equal(
      source.includes("<h2>Backup restored</h2><p>The mail store and storage key are in place again.</p>"),
      true
    );
    assert.equal(source.includes("Restart the server afterward"), false);
    assert.equal(/restart the server manually/i.test(source), false);
    assert.equal(/you must restart/i.test(source), false);
    assert.equal(source.includes("toLocaleString([], { dateStyle: \"medium\", timeStyle: \"short\" })"), true);
    assert.equal(source.includes('value="${escapeHtml(name)}"'), true);
    assert.equal(source.includes("presentBackupName(name)"), true);
    assert.equal(source.includes("presentBackupName(payload.backupName)"), true);
    assert.equal(source.includes('id="delete-backup"'), true);
    assert.equal(source.includes('id="restore-backup" class="caution-button"'), true);
    assert.equal(source.includes('id="backup-restore-confirm" class="caution-button"'), true);
    assert.equal(source.includes('id="delete-backup" class="danger-button"'), true);
    assert.equal(source.includes('id="backup-delete-confirm" class="danger-button"'), true);
    assert.equal(source.includes('id="create-backup" class="quiet-button"'), true);
    assert.equal(source.includes('id="backup-delete-cancel" class="quiet-button"'), true);
    assert.equal(source.includes('id="backup-restore-cancel" class="quiet-button"'), true);
    assert.equal(source.includes('id="restore-backup" class="danger-button"'), false);
    assert.equal(source.includes('id="backup-restore-confirm" class="danger-button"'), false);
    assert.equal(source.includes('id="backup-delete-dialog"'), true);
    assert.equal(source.includes("Delete this backup?"), true);
    assert.equal(
      source.includes("This permanently removes the selected server backup. The live mail store is not changed."),
      true
    );
    assert.equal(source.includes("<h2>Deleting backup</h2><p>Removing the selected server backup.</p>"), true);
    assert.equal(source.includes("<h2>Backup deleted</h2>"), true);
    assert.equal(source.includes("method: \"DELETE\""), true);
    assert.equal(source.includes("finishRestoreReconnect"), true);
    assert.equal(source.includes("waitUntilServerReachable"), true);
  });

  it("defines caution button tokens and shared disabled styling", async () => {
    const styles = await readFile(baseStylesPath, "utf8");
    assert.equal(styles.includes("--color-caution: #b45309;"), true);
    assert.equal(styles.includes("--color-caution-surface: #fffbeb;"), true);
    assert.equal(styles.includes(".caution-button"), true);
    assert.equal(styles.includes(".caution-button:disabled"), true);
    assert.equal(styles.includes("background: var(--color-caution-surface);"), true);
    assert.equal(styles.includes("color: var(--color-caution);"), true);
    assert.equal(styles.includes("border-color: var(--color-caution);"), true);
    assert.equal(styles.includes("--color-accent:"), false);
  });
});
