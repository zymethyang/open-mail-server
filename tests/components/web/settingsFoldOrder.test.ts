import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const settingsClientPath = path.join(process.cwd(), "src/web/client/components/settings/index.ts");

describe("settings fold order and defaults", () => {
  it("renders Certificate, DNS, settings form, Backup, then Listeners with approved defaults", async () => {
    const source = await readFile(settingsClientPath, "utf8");
    const certificateIndex = source.indexOf('id="certificate-card"');
    const dnsIndex = source.indexOf("renderDnsRecords(summary.hosting)");
    const settingsFormIndex = source.indexOf('id="settings-form"');
    const backupIndex = source.indexOf('id="backup-card"');
    const listenersIndex = source.indexOf('fold("Listeners"');
    assert.ok(certificateIndex > 0);
    assert.ok(dnsIndex > certificateIndex);
    assert.ok(settingsFormIndex > dnsIndex);
    assert.ok(backupIndex > settingsFormIndex);
    assert.ok(listenersIndex > backupIndex);

    assert.equal(source.includes('true\n      )}\n      <p class="hint">The web console on port'), true);
    assert.equal(source.includes('"settings-public-name"\n      )}\n      ${fold(\n        "Storage limits"'), true);
    assert.match(source, /fold\(\s*"Public name"[\s\S]*?false,\s*"settings-public-name"/);
    assert.match(source, /fold\(\s*"Storage limits"[\s\S]*?false,\s*"settings-storage-limits"/);
    assert.match(source, /relay\.enabled,\s*"settings-outgoing-relay"/);
    assert.match(source, /fold\(\s*"Create and restore"[\s\S]*?false,\s*"settings-backup"/);
    assert.match(source, /fold\("Listeners", listenerList\(summary\.listeners, summary\.publicPorts\), false, "settings-listeners"\)/);
    assert.equal(source.includes("localStorage"), false);
    assert.equal(source.includes('id="backup-restore-dialog"'), true);
    assert.equal(source.includes('id="backup-delete-dialog"'), true);
    assert.ok(source.indexOf('id="backup-restore-dialog"') > source.indexOf('"settings-backup"'));
    assert.equal(source.includes('element<HTMLDetailsElement>("#settings-public-name").open = true'), true);
    assert.equal(source.includes('element<HTMLDetailsElement>("#settings-outgoing-relay").open = true'), true);
  });
});
