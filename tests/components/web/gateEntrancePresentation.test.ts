import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const gateStylesPath = path.join(process.cwd(), "src/web/styles/gate.css");
const baseStylesPath = path.join(process.cwd(), "src/web/styles/base.css");
const mailboxStylesPath = path.join(process.cwd(), "src/web/styles/mailbox.css");
const responsiveStylesPath = path.join(process.cwd(), "src/web/styles/responsive.css");
const screenClientPath = path.join(process.cwd(), "src/web/client/components/screen/index.ts");
const setupClientPath = path.join(process.cwd(), "src/web/client/components/setup/index.ts");
const signInClientPath = path.join(process.cwd(), "src/web/client/components/signIn/index.ts");
const routerClientPath = path.join(process.cwd(), "src/web/client/router.ts");
const packageJsonPath = path.join(process.cwd(), "package.json");
const readmePath = path.join(process.cwd(), "README.md");
const indexHtmlPath = path.join(process.cwd(), "src/web/index.html");

const restingGateSelectors = [
  ".gate-brand-mark",
  ".gate-product-name",
  ".gate-copy h1",
  ".gate-copy p:not(.gate-product-name)",
  ".gate .panel"
];

function selectorBlock(styles: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m"));
  return match ? match[1] : null;
}

describe("gate entrance without typing flicker", () => {
  it("scopes entrance opacity under gate-entering and restores resting visibility", async () => {
    const styles = await readFile(gateStylesPath, "utf8");
    assert.equal(styles.includes(".gate.gate-entering .gate-brand-mark"), true);
    assert.equal(styles.includes(".gate.gate-entering .gate-product-name"), true);
    assert.equal(styles.includes(".gate.gate-entering .gate-copy h1"), true);
    assert.equal(styles.includes(".gate.gate-entering .gate-copy p:not(.gate-product-name)"), true);
    assert.equal(styles.includes(".gate.gate-entering .panel"), true);
    assert.equal(styles.includes("@keyframes gate-enter"), true);
    assert.equal(
      styles.includes(".gate.gate-entering .gate-brand-mark,\n  .gate.gate-entering .gate-product-name,"),
      true
    );
    for (const selector of restingGateSelectors) {
      const block = selectorBlock(styles, selector);
      assert.notEqual(block, null, `missing resting rule for ${selector}`);
      assert.equal(/\bopacity\s*:\s*0\b/.test(block || ""), false, `${selector} must not rest at opacity 0`);
    }
    assert.equal(/\bopacity\s*:\s*0\b/.test(selectorBlock(styles, ".gate.gate-entering .gate-brand-mark") || ""), true);
    assert.equal(/\bopacity\s*:\s*0\b/.test(selectorBlock(styles, ".gate.gate-entering .panel") || ""), true);
  });

  it("adds and clears gate-entering from showScreen for setup and sign-in only once per show", async () => {
    const source = await readFile(screenClientPath, "utf8");
    assert.equal(source.includes('classList.add("gate-entering")'), true);
    assert.equal(source.includes('classList.remove("gate-entering")'), true);
    assert.equal(source.includes("prefers-reduced-motion: reduce"), true);
    assert.equal(source.includes('name === "setup"'), true);
    assert.equal(source.includes('name === "sign-in"'), true);
    assert.equal(source.includes("clearGateEntranceTimer"), true);
    assert.equal(source.includes("startGateEntrance"), true);
    assert.equal(source.includes("finishGateEntrance"), true);
    assert.equal(source.includes("gateEntranceLastStaggerDelayMilliseconds = 240"), true);
    assert.equal(source.includes("gateEntranceDurationFallbackMilliseconds = 420"), true);
    assert.equal(/startGateEntrance\(applicationShell\)/.test(source), false);
    assert.equal(/if\s*\(\s*name\s*===\s*"application"\s*\)\s*\{[\s\S]*startGateEntrance/.test(source), false);
    assert.equal(source.includes("prefersReducedMotion()"), true);
    assert.match(
      source,
      /if\s*\(\s*prefersReducedMotion\(\)\s*\)\s*\{\s*return;\s*\}/
    );
  });

  it("does not re-trigger gate entrance from setup typing or form feedback", async () => {
    const setupSource = await readFile(setupClientPath, "utf8");
    assert.equal(setupSource.includes("showScreen"), false);
    assert.equal(setupSource.includes("gate-entering"), false);
    assert.equal(setupSource.includes("gate-enter"), false);
    assert.equal(setupSource.includes("addEventListener(\"input\""), false);
    assert.equal(setupSource.includes("addEventListener(\"keydown\""), false);
    assert.equal(setupSource.includes("addEventListener(\"keyup\""), false);
    assert.equal(setupSource.includes('addEventListener("submit"'), true);
  });

  it("keeps gate content fully visible when prefers-reduced-motion is reduce", async () => {
    const styles = await readFile(gateStylesPath, "utf8");
    const reducedMotionIndex = styles.indexOf("@media (prefers-reduced-motion: reduce)");
    assert.equal(reducedMotionIndex > -1, true);
    const reducedMotionBlock = styles.slice(reducedMotionIndex);
    assert.equal(reducedMotionBlock.includes(".gate.gate-entering .gate-brand-mark"), true);
    assert.equal(reducedMotionBlock.includes(".gate.gate-entering .gate-product-name"), true);
    assert.equal(reducedMotionBlock.includes(".gate.gate-entering .gate-copy h1"), true);
    assert.equal(reducedMotionBlock.includes(".gate.gate-entering .gate-copy p:not(.gate-product-name)"), true);
    assert.equal(reducedMotionBlock.includes(".gate.gate-entering .panel"), true);
    assert.equal(reducedMotionBlock.includes("animation: none"), true);
    assert.equal(reducedMotionBlock.includes("opacity: 1"), true);
    assert.equal(reducedMotionBlock.includes("transform: none"), true);
  });

  it("preserves sign-in field identifiers and password or OTP step behavior", async () => {
    const html = await readFile(indexHtmlPath, "utf8");
    const signInSource = await readFile(signInClientPath, "utf8");
    assert.equal(html.includes('id="sign-in-screen"'), true);
    assert.equal(html.includes('id="sign-in-form"'), true);
    assert.equal(html.includes('id="sign-in-address"'), true);
    assert.equal(html.includes('id="sign-in-password"'), true);
    assert.equal(html.includes('id="sign-in-password-step"'), true);
    assert.equal(html.includes('id="sign-in-code-step"'), true);
    assert.equal(html.includes('id="sign-in-code"'), true);
    assert.equal(html.includes('id="sign-in-back"'), true);
    assert.equal(html.includes('id="setup-organization"'), true);
    assert.equal(html.includes('id="setup-domain"'), true);
    assert.equal(html.includes('id="setup-public-address"'), true);
    assert.equal(html.includes('id="setup-name"'), true);
    assert.equal(html.includes('id="setup-address"'), true);
    assert.equal(html.includes('id="setup-password"'), true);
    assert.equal(signInSource.includes('codeStep.classList.add("gate-step-enter")'), true);
    assert.equal(signInSource.includes('passwordStep.classList.add("gate-step-enter")'), true);
    assert.equal(signInSource.includes("showScreen"), false);
    assert.equal(signInSource.includes("gate-entering"), false);
  });

  it("does not fade or animate the console main region on page changes", async () => {
    const [baseStyles, mailboxStyles, responsiveStyles, routerSource, screenSource] = await Promise.all([
      readFile(baseStylesPath, "utf8"),
      readFile(mailboxStylesPath, "utf8"),
      readFile(responsiveStylesPath, "utf8"),
      readFile(routerClientPath, "utf8"),
      readFile(screenClientPath, "utf8")
    ]);
    const combinedStyles = `${baseStyles}\n${mailboxStyles}\n${responsiveStyles}`;
    assert.equal(combinedStyles.includes("page-fade"), false);
    assert.equal(/\.main[^{]*\{[^}]*animation\s*:/.test(combinedStyles), false);
    assert.equal(/#application-shell[^{]*\{[^}]*animation\s*:/.test(combinedStyles), false);
    assert.equal(routerSource.includes("page-fade"), false);
    assert.equal(routerSource.includes("fade"), false);
    assert.equal(routerSource.includes("opacity"), false);
    assert.equal(/startGateEntrance\(applicationShell\)/.test(screenSource), false);
  });

  it("aligns package version and README first-run localhost guidance", async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version: string };
    const readme = await readFile(readmePath, "utf8");
    assert.equal(packageJson.version, "1.4.0");
    assert.equal(readme.includes("https://127.0.0.1"), true);
    assert.equal(readme.includes("loopback"), true);
    assert.equal(readme.includes("Remote browsers cannot create the company"), true);
  });
});
