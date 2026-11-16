import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const settingsClientPath = path.join(process.cwd(), "src/web/client/components/settings/index.ts");
const settingsStylesPath = path.join(process.cwd(), "src/web/styles/settings.css");
const gateStylesPath = path.join(process.cwd(), "src/web/styles/gate.css");

describe("certificate settings mode presentation", () => {
  it("uses radio mode panels without remounting the card or entrance fade", async () => {
    const source = await readFile(settingsClientPath, "utf8");
    assert.equal(source.includes('name="certificate-mode"'), true);
    assert.equal(source.includes('value="upload"'), true);
    assert.equal(source.includes('value="lets-encrypt"'), true);
    assert.equal(source.includes("applyCertificateModePanels"), true);
    assert.equal(source.includes("selectCertificateMode"), true);
    assert.equal(source.includes("uploadPanel.hidden"), true);
    assert.equal(source.includes("letsEncryptPanel.hidden"), true);
    assert.equal(/#certificate-card["']\)\.innerHTML/.test(source), false);
    assert.equal(source.includes("gate-entering"), false);
    assert.equal(source.includes("page-fade"), false);
    assert.equal(source.includes("gate-enter"), false);
    assert.match(source, /acmeManaged\s*\?\s*"lets-encrypt"\s*:\s*"upload"/);
  });

  it("keeps certificate card and mode panels at resting opacity 1", async () => {
    const styles = await readFile(settingsStylesPath, "utf8");
    assert.equal(styles.includes("#certificate-card { margin-top: 0; opacity: 1; }"), true);
    assert.equal(styles.includes("#certificate-card .certificate-mode-panel { margin-top: var(--space-4); opacity: 1; }"), true);
    assert.equal(styles.includes("gate-enter"), false);
    assert.equal(styles.includes("page-fade"), false);
    assert.equal(/#certificate-card[^{]*\{[^}]*opacity\s*:\s*0/.test(styles), false);
    assert.equal(/certificate-mode-panel[^{]*\{[^}]*opacity\s*:\s*0/.test(styles), false);
  });

  it("keeps gate entrance opacity scoped under gate-entering only", async () => {
    const styles = await readFile(gateStylesPath, "utf8");
    assert.equal(styles.includes(".gate.gate-entering .panel"), true);
    const restingPanel = styles.match(/\.gate\s+\.panel\s*\{([^}]*)\}/);
    assert.notEqual(restingPanel, null);
    assert.equal(/\bopacity\s*:\s*0\b/.test(restingPanel?.[1] || ""), false);
  });
});
