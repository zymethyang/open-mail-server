import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const gateStylesPath = path.join(process.cwd(), "src/web/styles/gate.css");
const indexHtmlPath = path.join(process.cwd(), "src/web/index.html");
const webServerPath = path.join(process.cwd(), "src/components/web/index.ts");
const signInClientPath = path.join(process.cwd(), "src/web/client/components/signIn/index.ts");

describe("sign-in gate presentation", () => {
  it("uses the approved brand-first gate tokens, fonts, and motions", async () => {
    const styles = await readFile(gateStylesPath, "utf8");
    const html = await readFile(indexHtmlPath, "utf8");
    assert.equal(styles.includes("--gate-ink: #0c1b2a;"), true);
    assert.equal(styles.includes("--gate-primary: #0b57d0;"), true);
    assert.equal(styles.includes('--gate-font-display: "Outfit"'), true);
    assert.equal(styles.includes('--gate-font-body: "Work Sans"'), true);
    assert.equal(styles.includes("gate-atmosphere-drift"), true);
    assert.equal(styles.includes("gate-enter"), true);
    assert.equal(styles.includes("gate-step-enter"), true);
    assert.equal(styles.includes("@media (prefers-reduced-motion: reduce)"), true);
    assert.equal(styles.includes("Inter"), false);
    assert.equal(styles.includes("Roboto"), false);
    assert.equal(styles.includes("#667eea"), false);
    assert.equal(styles.includes("#F4F1EA"), false);
    assert.equal(html.includes("family=Outfit"), true);
    assert.equal(html.includes("family=Work+Sans"), true);
    assert.equal(html.includes('class="gate-product-name"'), true);
    assert.equal(html.includes('class="gate-atmosphere" aria-hidden="true"'), true);
    assert.equal(html.includes('id="sign-in-screen"'), true);
    assert.equal(html.includes('id="sign-in-title"'), true);
    assert.equal(html.includes('id="sign-in-detail"'), true);
    assert.equal(html.includes('id="sign-in-form"'), true);
    assert.equal(html.includes('id="sign-in-password-step"'), true);
    assert.equal(html.includes('id="sign-in-code-step"'), true);
    assert.equal(html.includes('id="sign-in-back"'), true);
    assert.equal(html.includes("Welcome back"), true);
  });

  it("narrows CSP for Google Fonts without relaxing script-src", async () => {
    const source = await readFile(webServerPath, "utf8");
    assert.equal(
      source.includes(
        "style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'"
      ),
      true
    );
    assert.equal(source.includes("unsafe-inline"), false);
    assert.equal(source.includes("unsafe-eval"), false);
    assert.equal(source.includes("script-src 'self' https:"), false);
  });

  it("applies the OTP step enter class without changing auth identifiers", async () => {
    const source = await readFile(signInClientPath, "utf8");
    assert.equal(source.includes('codeStep.classList.add("gate-step-enter")'), true);
    assert.equal(source.includes('codeStep.classList.remove("gate-step-enter")'), true);
    assert.equal(source.includes('passwordStep.classList.add("gate-step-enter")'), true);
    assert.equal(source.includes("ApiEndpoint.Session"), true);
    assert.equal(source.includes("ApiEndpoint.SessionOneTimePassword"), true);
    assert.equal(source.includes("#sign-in-code"), true);
    assert.equal(source.includes("#sign-in-password"), true);
    assert.equal(source.includes("#sign-in-back"), true);
  });
});
