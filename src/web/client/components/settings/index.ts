import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { ServerPort } from "../../enums/serverPort.js";
import { requestJson } from "../../http/jsonClient.js";
import type { ActivitySummary, CertificateDescription, ServerSettings } from "../../interfaces/models.js";
import type { Page } from "../../interfaces/page.js";
import { applicationState } from "../../state/applicationState.js";
import { element } from "../../utils/element.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { errorMessage } from "../../utils/errorMessage.js";
import { clearFormErrors, replaceMainContent, showFormError } from "../../utils/formFeedback.js";
import { currentRouteGeneration } from "../../state/routeGeneration.js";
import { fold } from "../../utils/presentation.js";
import { bindDnsRecordCopies, listenerList, renderDnsRecords } from "../overview/hosting.js";

function presentCertificateDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function certificateKind(certificate: CertificateDescription): string {
  if (certificate.selfSigned) {
    return "Self-signed";
  }
  const intermediateCount = certificate.intermediateCount || 0;
  if (intermediateCount === 1) {
    return "Issued by a certificate authority, with the intermediate certificate";
  }
  if (intermediateCount > 1) {
    return `Issued by a certificate authority, with ${intermediateCount} intermediate certificates`;
  }
  return "Issued by a certificate authority";
}

function certificateMarkup(certificate: CertificateDescription): string {
  const names = certificate.names && certificate.names.length ? certificate.names.join(", ") : "None listed";
  return `<dl class="record-list">
    <div><dt>Subject</dt><dd>${escapeHtml(certificate.subject)}</dd></div>
    <div><dt>Issuer</dt><dd>${escapeHtml(certificate.issuer)}</dd></div>
    <div><dt>Names</dt><dd>${escapeHtml(names)}</dd></div>
    <div><dt>Valid from</dt><dd>${escapeHtml(presentCertificateDate(certificate.validFrom))}</dd></div>
    <div><dt>Valid until</dt><dd>${escapeHtml(presentCertificateDate(certificate.validUntil))}</dd></div>
    <div><dt>Kind</dt><dd>${escapeHtml(certificateKind(certificate))}</dd></div>
  </dl>`;
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("The file could not be read")));
    reader.readAsText(file);
  });
}

function relaySelection(): { port: number; security: string } {
  if (element<HTMLSelectElement>("#settings-relay-port").value === "465") {
    return { port: 465, security: "tls" };
  }
  return { port: 587, security: "starttls" };
}

function settingsRequestBody(): string {
  const relay = relaySelection();
  return JSON.stringify({
    publicHostname: element<HTMLInputElement>("#settings-hostname").value,
    relay: {
      enabled: element<HTMLInputElement>("#settings-relay-enabled").checked,
      host: element<HTMLInputElement>("#settings-relay-host").value,
      port: relay.port,
      security: relay.security,
      username: element<HTMLInputElement>("#settings-relay-username").value,
      password: element<HTMLInputElement>("#settings-relay-password").value
    }
  });
}

function settingsErrorField(message: string): string {
  if (message.includes("hostname") || message.includes("Hostname")) {
    return "settings-hostname";
  }
  if (message.includes("port") || message.includes("Port") || message.includes("STARTTLS") || message.includes("TLS")) {
    return "settings-relay-port";
  }
  return "settings-relay-host";
}

async function saveSettings(): Promise<void> {
  const settingsForm = element<HTMLFormElement>("#settings-form");
  const settingsSummary = element<HTMLElement>("#settings-summary");
  settingsSummary.className = "error-summary";
  clearFormErrors(settingsForm, settingsSummary);
  try {
    await requestJson(ApiEndpoint.Settings, { method: "PUT", body: settingsRequestBody() });
    await renderSettings(true);
  } catch (error) {
    const message = errorMessage(error);
    const field = settingsErrorField(message);
    if (field !== "settings-hostname") {
      settingsForm.querySelector("details")?.setAttribute("open", "");
    }
    showFormError(settingsForm, settingsSummary, message, field);
  }
}

function bindCertificateCard(): void {
  const summary = element<HTMLElement>("#certificate-summary");
  const dialog = element<HTMLDialogElement>("#certificate-dialog");
  const dialogSummary = element<HTMLElement>("#certificate-dialog-summary");
  requestJson<{ certificate: CertificateDescription }>(ApiEndpoint.Certificate)
    .then((payload) => {
      element("#certificate-details").innerHTML = certificateMarkup(payload.certificate);
    })
    .catch((error: unknown) => {
      summary.hidden = false;
      summary.innerHTML = `<h2>There is a problem</h2><p>${escapeHtml(errorMessage(error))}</p>`;
    });
  element<HTMLButtonElement>("#certificate-upload-button").addEventListener("click", () => {
    element<HTMLFormElement>("#certificate-form").reset();
    dialogSummary.className = "error-summary";
    clearFormErrors(element("#certificate-form"), dialogSummary);
    dialog.showModal();
  });
  element<HTMLButtonElement>("#certificate-cancel").addEventListener("click", () => {
    dialog.close();
  });
  element<HTMLFormElement>("#certificate-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    dialogSummary.className = "error-summary";
    clearFormErrors(form, dialogSummary);
    const certificateFile = element<HTMLInputElement>("#certificate-file").files?.[0];
    const privateKeyFile = element<HTMLInputElement>("#private-key-file").files?.[0];
    const intermediateFile = element<HTMLInputElement>("#certificate-chain-file").files?.[0];
    if (!certificateFile || !privateKeyFile) {
      showFormError(form, dialogSummary, "Choose both the certificate and the private key.", certificateFile ? "private-key-file" : "certificate-file");
      return;
    }
    try {
      const [certificate, privateKey, intermediateCertificates] = await Promise.all([
        readTextFile(certificateFile),
        readTextFile(privateKeyFile),
        intermediateFile ? readTextFile(intermediateFile) : Promise.resolve("")
      ]);
      const payload = await requestJson<{ certificate: CertificateDescription }>(ApiEndpoint.Certificate, {
        method: "POST",
        body: JSON.stringify({ certificate, privateKey, intermediateCertificates })
      });
      element("#certificate-details").innerHTML = certificateMarkup(payload.certificate);
      form.reset();
      dialog.close();
      summary.className = "notice";
      summary.hidden = false;
      summary.innerHTML = "<h2>Certificate uploaded</h2><p>New mail connections use this certificate.</p>";
    } catch (error) {
      showFormError(form, dialogSummary, errorMessage(error), "certificate-file");
    }
  });
}

async function renderSettings(saved = false): Promise<void> {
  const generation = currentRouteGeneration();
  const [payload, summary] = await Promise.all([
    requestJson<{ settings: ServerSettings }>(ApiEndpoint.Settings),
    requestJson<ActivitySummary>(ApiEndpoint.ActivitySummary)
  ]);
  if (applicationState.bootstrap) {
    applicationState.bootstrap.hosting = summary.hosting;
  }
  const settings = payload.settings;
  const relay = settings.relay;
  const secureRelaySelected = relay.port === ServerPort.SmtpSecure && relay.security === "tls";
  const savedNotice = saved
    ? `<div class="notice"><h2>Settings saved</h2><p>The public name and relay apply now.</p></div>`
    : "";
  replaceMainContent(`
    <header class="page-header"><div><p class="eyebrow">Configuration</p><h1>Settings</h1></div></header>
    ${savedNotice}
    <form id="settings-form" class="card">
      <div id="settings-summary" class="error-summary" tabindex="-1" hidden></div>
      <h2>Public name</h2>
      <label for="settings-hostname">Hostname</label>
      <input id="settings-hostname" value="${escapeHtml(settings.publicHostname)}" placeholder="mail.example.com">
      <p class="hint">This name is used in the mail greeting and the DNS guide. Leave it empty to use the company domain.</p>
      ${fold(`Outgoing relay<span class="fold-status">${relay.enabled ? "On" : "Off"}</span>`, `<label class="choice" for="settings-relay-enabled"><input id="settings-relay-enabled" type="checkbox" ${relay.enabled ? "checked" : ""}> Send external mail through a relay</label>
      <label for="settings-relay-host">Relay host</label>
      <input id="settings-relay-host" value="${escapeHtml(relay.host)}" placeholder="smtp.example.net">
      <label for="settings-relay-port">Port</label>
      <select id="settings-relay-port">
        <option value="${ServerPort.SmtpSubmission}" ${secureRelaySelected ? "" : "selected"}>${ServerPort.SmtpSubmission} STARTTLS</option>
        <option value="${ServerPort.SmtpSecure}" ${secureRelaySelected ? "selected" : ""}>${ServerPort.SmtpSecure} TLS</option>
      </select>
      <label for="settings-relay-username">Username</label>
      <input id="settings-relay-username" value="${escapeHtml(relay.username)}" autocomplete="off">
      <label for="settings-relay-password">Password</label>
      <input id="settings-relay-password" type="password" autocomplete="new-password" placeholder="${relay.passwordSaved ? "Saved. Enter a new password to replace it." : ""}">`, relay.enabled)}
      <div class="form-actions"><button class="primary-button" type="submit">Save settings</button></div>
    </form>
    <section class="card stack-card" id="certificate-card">
      <h2>Certificate</h2>
      <div id="certificate-summary" class="error-summary" tabindex="-1" hidden></div>
      <div id="certificate-details"><p class="hint">Loading the current certificate.</p></div>
      <p class="hint">The web console on port ${ServerPort.Web} uses this certificate. A missing certificate is created in the storage directory when the server starts. An existing certificate is kept there and is not written into the source tree.</p>
      <div class="form-actions"><button id="certificate-upload-button" class="quiet-button" type="button">Upload certificate</button></div>
    </section>
    <dialog id="certificate-dialog" class="modal" aria-labelledby="certificate-dialog-title">
      <form id="certificate-form">
        <h2 id="certificate-dialog-title">Upload certificate</h2>
        <div id="certificate-dialog-summary" class="error-summary" tabindex="-1" hidden></div>
        <label for="certificate-file">Certificate file</label>
        <input id="certificate-file" type="file" accept=".pem,.crt,.cer">
        <label for="certificate-chain-file">Intermediate certificates</label>
        <input id="certificate-chain-file" type="file" accept=".pem,.crt,.cer,.ca-bundle">
        <label for="private-key-file">Private key file</label>
        <input id="private-key-file" type="file" accept=".pem,.key">
        <p class="hint">Use the PEM certificate and private key from your provider. If the intermediate certificates arrived in a separate bundle, add that file. Mail uses them immediately.</p>
        <div class="form-actions">
          <button id="certificate-cancel" class="quiet-button" type="button">Cancel</button>
          <button class="primary-button" type="submit">Upload</button>
        </div>
      </form>
    </dialog>
    ${renderDnsRecords(summary.hosting)}
    ${fold("Listeners", listenerList(summary.listeners, summary.publicPorts))}`, generation, currentRouteGeneration());
  if (generation !== currentRouteGeneration()) {
    return;
  }
  element<HTMLFormElement>("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSettings();
  });
  bindCertificateCard();
  bindDnsRecordCopies();
}

export const settingsPage: Page = {
  matches(route, role) {
    return route.startsWith("settings") && role === "administrator";
  },
  async render() {
    await renderSettings();
  }
};
