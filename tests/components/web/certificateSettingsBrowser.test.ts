import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAcmeAccountKey } from "../../../src/components/certificate/utils/acmeJose.js";
import { generateAuthoritySignedCertificate } from "../../../src/components/certificate/utils/selfSignedCertificate.js";
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

describe("certificate settings in the browser", () => {
  it("shows mode radios, Upload and Let’s Encrypt panels, and Get versus Renew", { timeout: 180000 }, async () => {
    const consoleServer = await startWebConsole({
      acmeIssuer: async ({ hostname }) => {
        const issued = generateAuthoritySignedCertificate([hostname]);
        const account = createAcmeAccountKey();
        return {
          certificatePem: `${issued.certificate}${issued.intermediateCertificate}`,
          privateKeyPem: issued.privateKey,
          accountKeyPem: account.privateKeyPem,
          accountUrl: "https://acme.test/account/browser"
        };
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
      await requestJson(
        consoleServer.baseUrl,
        "PUT",
        "/api/admin/settings",
        {
          publicHostname: "mail.example.com",
          relay: { enabled: false, host: "", port: 587, security: "starttls", username: "", password: "" }
        },
        setup.cookieHeader
      );

      await browser.openAddress(`${consoleServer.baseUrl}/`);
      await browser.signIn("ada@acme.test", "correct-horse");
      await browser.followPath("/admin/settings");

      const purpose = await waitFor(
        browser,
        "Certificate purpose line",
        `(() => {
          const card = document.querySelector("#certificate-card");
          if (!(card instanceof HTMLElement)) return "waiting";
          const hints = [...card.querySelectorAll(":scope > p.hint")].map((node) => node.textContent.trim());
          return hints.find((text) => text === "The web console and mail listeners use this certificate.") || "waiting";
        })()`
      );
      assert.equal(purpose, "The web console and mail listeners use this certificate.");

      const modeLegend = await waitFor(
        browser,
        "Certificate mode legend",
        `(() => {
          const legend = document.querySelector("#certificate-mode legend");
          return legend instanceof HTMLElement ? legend.textContent.trim() : "waiting";
        })()`
      );
      assert.equal(modeLegend, "How do you want to manage the certificate?");

      const initialMode = await waitFor(
        browser,
        "Upload mode selected by default",
        `(() => {
          const upload = document.querySelector("#certificate-mode-upload");
          const letsEncrypt = document.querySelector("#certificate-mode-lets-encrypt");
          const uploadPanel = document.querySelector("#certificate-mode-upload-panel");
          const letsEncryptPanel = document.querySelector("#certificate-mode-lets-encrypt-panel");
          const hostname = document.querySelector("#certificate-acme-hostname");
          const contact = document.querySelector("#certificate-acme-contact");
          const details = document.querySelector("#certificate-details");
          if (!(upload instanceof HTMLInputElement) || !(letsEncrypt instanceof HTMLInputElement)) return "waiting";
          if (!(uploadPanel instanceof HTMLElement) || !(letsEncryptPanel instanceof HTMLElement)) return "waiting";
          if (!(hostname instanceof HTMLElement) || !(contact instanceof HTMLElement)) return "waiting";
          if (!(details instanceof HTMLElement) || !details.querySelector("dl.record-list")) return "waiting";
          if (!upload.checked || letsEncrypt.checked) return "waiting";
          if (uploadPanel.hidden || !letsEncryptPanel.hidden) return "waiting";
          if (!hostname.textContent.includes("mail.example.com")) return "waiting";
          if (!contact.textContent.includes("ada@acme.test")) return "waiting";
          return "upload";
        })()`
      );
      assert.equal(initialMode, "upload");

      const uploadHint = await waitFor(
        browser,
        "Upload mode hint",
        `(() => {
          const panel = document.querySelector("#certificate-mode-upload-panel");
          const hint = panel?.querySelector("p.hint");
          return hint instanceof HTMLElement ? hint.textContent.trim() : "waiting";
        })()`
      );
      assert.equal(
        uploadHint,
        "Upload your PEM certificate and private key. Add intermediates if you have them. Mail and the web console use it right away."
      );

      await browser.script(`(() => {
        const input = document.querySelector("#certificate-mode-lets-encrypt");
        if (input instanceof HTMLInputElement) {
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      })()`);

      const letsEncryptMode = await waitFor(
        browser,
        "Let’s Encrypt mode panel visible",
        `(() => {
          const uploadPanel = document.querySelector("#certificate-mode-upload-panel");
          const letsEncryptPanel = document.querySelector("#certificate-mode-lets-encrypt-panel");
          if (!(uploadPanel instanceof HTMLElement) || !(letsEncryptPanel instanceof HTMLElement)) return "waiting";
          if (!uploadPanel.hidden || letsEncryptPanel.hidden) return "waiting";
          const hostname = document.querySelector("#certificate-acme-hostname");
          const contact = document.querySelector("#certificate-acme-contact");
          if (!(hostname instanceof HTMLElement) || !(contact instanceof HTMLElement)) return "waiting";
          const hostnameText = hostname.textContent.trim();
          const contactText = contact.textContent.trim();
          if (!hostnameText.includes("mail.example.com") || !contactText.includes("ada@acme.test")) return "waiting";
          return [hostnameText, contactText].join("|");
        })()`
      );
      assert.equal(
        letsEncryptMode,
        "We’ll get a certificate for mail.example.com.|Contact for Let’s Encrypt: ada@acme.test."
      );

      const verification = await waitFor(
        browser,
        "Let’s Encrypt verification hint",
        `(() => {
          const panel = document.querySelector("#certificate-mode-lets-encrypt-panel");
          if (!(panel instanceof HTMLElement)) return "waiting";
          const hints = [...panel.querySelectorAll("p.hint")].map((node) => node.textContent.trim());
          return hints.find((text) => text.includes("port 80") && text.includes("DNS")) || "waiting";
        })()`
      );
      assert.equal(
        verification,
        "Let’s Encrypt checks this over port 80. Point its DNS at this server and open port 80."
      );

      const getLabel = await waitFor(
        browser,
        "Get Let’s Encrypt button",
        `(() => {
          const button = document.querySelector("#certificate-acme-button");
          return button instanceof HTMLButtonElement ? button.textContent.trim() : "waiting";
        })()`
      );
      assert.equal(getLabel, "Get Let’s Encrypt certificate");

      const visiblePrimaries = await waitFor(
        browser,
        "One primary certificate action visible",
        `(() => {
          const uploadButton = document.querySelector("#certificate-upload-button");
          const acmeButton = document.querySelector("#certificate-acme-button");
          const uploadPanel = document.querySelector("#certificate-mode-upload-panel");
          const letsEncryptPanel = document.querySelector("#certificate-mode-lets-encrypt-panel");
          if (!(uploadButton instanceof HTMLButtonElement) || !(acmeButton instanceof HTMLButtonElement)) return "waiting";
          if (!(uploadPanel instanceof HTMLElement) || !(letsEncryptPanel instanceof HTMLElement)) return "waiting";
          const uploadVisible = !uploadPanel.hidden;
          const acmeVisible = !letsEncryptPanel.hidden;
          if (uploadVisible === acmeVisible) return "waiting";
          return uploadVisible ? "upload" : "lets-encrypt";
        })()`
      );
      assert.equal(visiblePrimaries, "lets-encrypt");

      await browser.script(`(() => {
        const button = document.querySelector("#certificate-acme-button");
        if (button instanceof HTMLButtonElement) button.click();
      })()`);

      const dialogTitle = await waitFor(
        browser,
        "ACME dialog title",
        `(() => {
          const dialog = document.querySelector("#certificate-acme-dialog");
          const title = document.querySelector("#certificate-acme-dialog-title");
          if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return "waiting";
          return title instanceof HTMLElement ? title.textContent.trim() : "waiting";
        })()`
      );
      assert.equal(dialogTitle, "Get a Let’s Encrypt certificate?");

      const body2 = await waitFor(
        browser,
        "ACME dialog body about port 80",
        `(() => {
          const node = document.querySelector("#certificate-acme-body-2");
          return node instanceof HTMLElement ? node.textContent.trim() : "waiting";
        })()`
      );
      assert.match(body2, /port 80 is open and reachable/);

      await browser.script(`(() => {
        const button = document.querySelector("#certificate-acme-confirm");
        if (button instanceof HTMLButtonElement) button.click();
      })()`);

      const success = await waitFor(
        browser,
        "ACME success notice",
        `(() => {
          const summary = document.querySelector("#certificate-summary");
          if (!(summary instanceof HTMLElement) || summary.hidden) return "waiting";
          const heading = summary.querySelector("h2");
          const text = heading ? heading.textContent.trim() : "";
          if (text === "Let’s Encrypt certificate ready" || text === "Let’s Encrypt certificate renewed") return text;
          if (text === "There is a problem") return text;
          return "waiting";
        })()`
      );
      assert.equal(success, "Let’s Encrypt certificate ready");

      const kind = await waitFor(
        browser,
        "Certificate kind Let’s Encrypt",
        `(() => {
          const rows = [...document.querySelectorAll("#certificate-details dt")];
          const kindRow = rows.find((node) => node.textContent.trim() === "Kind");
          const value = kindRow?.nextElementSibling;
          return value instanceof HTMLElement ? value.textContent.trim() : "waiting";
        })()`
      );
      assert.equal(kind, "Let’s Encrypt");

      const managedMode = await waitFor(
        browser,
        "Let’s Encrypt mode after ACME success",
        `(() => {
          const letsEncrypt = document.querySelector("#certificate-mode-lets-encrypt");
          const letsEncryptPanel = document.querySelector("#certificate-mode-lets-encrypt-panel");
          const button = document.querySelector("#certificate-acme-button");
          if (!(letsEncrypt instanceof HTMLInputElement) || !(letsEncryptPanel instanceof HTMLElement)) return "waiting";
          if (!(button instanceof HTMLButtonElement)) return "waiting";
          if (!letsEncrypt.checked || letsEncryptPanel.hidden) return "waiting";
          return button.textContent.trim();
        })()`
      );
      assert.equal(managedMode, "Renew Let’s Encrypt certificate");

      await browser.script(`(() => {
        const input = document.querySelector("#certificate-mode-upload");
        if (input instanceof HTMLInputElement) {
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      })()`);

      const uploadLabel = await waitFor(
        browser,
        "Upload certificate button after mode switch",
        `(() => {
          const uploadPanel = document.querySelector("#certificate-mode-upload-panel");
          const button = document.querySelector("#certificate-upload-button");
          if (!(uploadPanel instanceof HTMLElement) || uploadPanel.hidden) return "waiting";
          return button instanceof HTMLButtonElement ? button.textContent.trim() : "waiting";
        })()`
      );
      assert.equal(uploadLabel, "Upload certificate");

      const noEntranceClass = await browser.script(`(() => {
        const card = document.querySelector("#certificate-card");
        if (!(card instanceof HTMLElement)) return "missing";
        const opacity = getComputedStyle(card).opacity;
        const hasEntrance = [...card.classList].some((name) => /enter|fade/i.test(name));
        return opacity === "1" && !hasEntrance ? "stable" : \`opacity=\${opacity};entrance=\${hasEntrance}\`;
      })()`);
      assert.equal(noEntranceClass, "stable");
    } finally {
      await browser.close();
      await consoleServer.stop();
    }
  });
});
