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
    return "Issued by a certificate authority, with intermediate";
  }
  if (intermediateCount > 1) {
    return `Issued by a certificate authority, with ${intermediateCount} intermediates`;
  }
  return "Issued by a certificate authority";
}

function certificateMarkup(certificate: CertificateDescription): string {
  const names = certificate.names && certificate.names.length ? certificate.names.join(", ") : "None listed";
  const renewal = certificate.renewalRequired
    ? `<p class="hint">Expires in ${certificate.daysRemaining ?? 0} days. Self-signed renews automatically; uploaded certificates need a new file.</p>`
    : "";
  return `<dl class="record-list">
    <div><dt>Subject</dt><dd>${escapeHtml(certificate.subject)}</dd></div>
    <div><dt>Issuer</dt><dd>${escapeHtml(certificate.issuer)}</dd></div>
    <div><dt>Names</dt><dd>${escapeHtml(names)}</dd></div>
    <div><dt>Valid from</dt><dd>${escapeHtml(presentCertificateDate(certificate.validFrom))}</dd></div>
    <div><dt>Valid until</dt><dd>${escapeHtml(presentCertificateDate(certificate.validUntil))}</dd></div>
    <div><dt>Kind</dt><dd>${escapeHtml(certificateKind(certificate))}</dd></div>
  </dl>${renewal}`;
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
    },
    limits: {
      maximumMessageBytes: Number(element<HTMLInputElement>("#settings-message-megabytes").value) * 1024 * 1024,
      mailboxQuotaBytes: Number(element<HTMLInputElement>("#settings-quota-megabytes").value) * 1024 * 1024,
      maximumUnauthenticatedConnections: Number(element<HTMLInputElement>("#settings-connection-limit").value),
      maximumUnauthenticatedMessages: Number(element<HTMLInputElement>("#settings-message-limit").value)
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
    if (field === "settings-hostname") {
      element<HTMLDetailsElement>("#settings-public-name").open = true;
    } else {
      element<HTMLDetailsElement>("#settings-outgoing-relay").open = true;
    }
    showFormError(settingsForm, settingsSummary, message, field);
  }
}

function presentBackupName(backupName: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(backupName);
  if (!match) {
    return backupName;
  }
  const parsed = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
  if (Number.isNaN(parsed)) {
    return backupName;
  }
  return new Date(parsed).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function backupListMarkup(backupNames: string[]): string {
  if (!backupNames.length) {
    return `<p id="backup-empty">No backups yet.</p>`;
  }
  const options = backupNames
    .map(
      (name, index) =>
        `<label class="choice" for="backup-selection-${index}"><input id="backup-selection-${index}" type="radio" name="backup-selection" value="${escapeHtml(name)}"> ${escapeHtml(presentBackupName(name))}</label>`
    )
    .join("");
  return `<fieldset id="backup-list" class="backup-list"><legend>Server backups</legend>${options}</fieldset>`;
}

function selectedBackupName(): string {
  const selected = document.querySelector<HTMLInputElement>('input[name="backup-selection"]:checked');
  return selected?.value || "";
}

function updateBackupActionButtons(): void {
  const selected = Boolean(selectedBackupName());
  element<HTMLButtonElement>("#restore-backup").disabled = !selected;
  element<HTMLButtonElement>("#delete-backup").disabled = !selected;
}

function setBackupControlsDisabled(disabled: boolean): void {
  element<HTMLButtonElement>("#create-backup").disabled = disabled;
  element<HTMLButtonElement>("#backup-restore-confirm").disabled = disabled;
  element<HTMLButtonElement>("#backup-delete-confirm").disabled = disabled;
  document.querySelectorAll<HTMLInputElement>('input[name="backup-selection"]').forEach((input) => {
    input.disabled = disabled;
  });
  if (disabled) {
    element<HTMLButtonElement>("#restore-backup").disabled = true;
    element<HTMLButtonElement>("#delete-backup").disabled = true;
    return;
  }
  updateBackupActionButtons();
}

function bindBackupSelection(): void {
  document.querySelectorAll<HTMLInputElement>('input[name="backup-selection"]').forEach((input) => {
    input.addEventListener("change", () => {
      updateBackupActionButtons();
    });
  });
  updateBackupActionButtons();
}

async function refreshBackupList(summary: HTMLElement): Promise<void> {
  const payload = await requestJson<{ backups: string[] }>(ApiEndpoint.Backup);
  const listHost = element("#backup-list-host");
  listHost.innerHTML = backupListMarkup(payload.backups || []);
  bindBackupSelection();
  summary.className = "notice";
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntilServerReachable(maximumAttempts = 90, delayMilliseconds = 1000): Promise<boolean> {
  const downtimeDeadline = Date.now() + 15_000;
  let sawUnreachable = false;
  while (!sawUnreachable && Date.now() < downtimeDeadline) {
    try {
      await fetch("/health", { credentials: "same-origin", cache: "no-store" });
    } catch {
      sawUnreachable = true;
      break;
    }
    await delay(250);
  }
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      const response = await fetch("/health", { credentials: "same-origin", cache: "no-store" });
      if (response.status > 0) {
        return true;
      }
    } catch {
      // Server is still restarting.
    }
    await delay(delayMilliseconds);
  }
  return false;
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

function bindBackupCard(initialBackups: string[]): void {
  const summary = element<HTMLElement>("#backup-summary");
  const listHost = element("#backup-list-host");
  listHost.innerHTML = backupListMarkup(initialBackups);
  bindBackupSelection();
  const restoreDialog = element<HTMLDialogElement>("#backup-restore-dialog");
  const deleteDialog = element<HTMLDialogElement>("#backup-delete-dialog");
  element<HTMLButtonElement>("#create-backup").addEventListener("click", () => {
    setBackupControlsDisabled(true);
    summary.className = "notice";
    summary.hidden = false;
    summary.innerHTML = "<h2>Creating backup</h2><p>Copying the mail store and storage key.</p>";
    void requestJson<{ backupName: string }>(ApiEndpoint.Backup, { method: "POST", body: "{}" })
      .then(async (payload) => {
        await refreshBackupList(summary);
        setBackupControlsDisabled(false);
        summary.hidden = false;
        summary.innerHTML = `<h2>Backup created</h2><p>Saved as ${escapeHtml(presentBackupName(payload.backupName))}.</p>`;
      })
      .catch((error: unknown) => {
        summary.className = "error-summary";
        summary.hidden = false;
        summary.innerHTML = `<h2>There is a problem</h2><p>${escapeHtml(errorMessage(error))}</p>`;
        setBackupControlsDisabled(false);
        summary.focus();
      });
  });
  element<HTMLButtonElement>("#delete-backup").addEventListener("click", () => {
    if (!selectedBackupName()) {
      return;
    }
    deleteDialog.showModal();
  });
  element<HTMLButtonElement>("#backup-delete-cancel").addEventListener("click", () => {
    deleteDialog.close();
  });
  element<HTMLButtonElement>("#backup-delete-confirm").addEventListener("click", () => {
    const backupName = selectedBackupName();
    if (!backupName) {
      deleteDialog.close();
      return;
    }
    const label = presentBackupName(backupName);
    deleteDialog.close();
    setBackupControlsDisabled(true);
    summary.className = "notice";
    summary.hidden = false;
    summary.innerHTML = "<h2>Deleting backup</h2><p>Removing the selected server backup.</p>";
    void requestJson<{ deleted: boolean; backupName: string }>(ApiEndpoint.Backup, {
      method: "DELETE",
      body: JSON.stringify({ backupName })
    })
      .then(async () => {
        await refreshBackupList(summary);
        setBackupControlsDisabled(false);
        summary.hidden = false;
        summary.innerHTML = `<h2>Backup deleted</h2><p>Removed ${escapeHtml(label)}.</p>`;
        summary.focus();
      })
      .catch((error: unknown) => {
        summary.className = "error-summary";
        summary.hidden = false;
        summary.innerHTML = `<h2>There is a problem</h2><p>${escapeHtml(errorMessage(error))}</p>`;
        setBackupControlsDisabled(false);
        summary.focus();
      });
  });
  element<HTMLButtonElement>("#restore-backup").addEventListener("click", () => {
    if (!selectedBackupName()) {
      return;
    }
    restoreDialog.showModal();
  });
  element<HTMLButtonElement>("#backup-restore-cancel").addEventListener("click", () => {
    restoreDialog.close();
  });
  element<HTMLButtonElement>("#backup-restore-confirm").addEventListener("click", () => {
    const backupName = selectedBackupName();
    if (!backupName) {
      restoreDialog.close();
      return;
    }
    restoreDialog.close();
    setBackupControlsDisabled(true);
    summary.className = "notice";
    summary.hidden = false;
    summary.innerHTML = "<h2>Restoring…</h2><p>Replacing the mail store and storage key.</p>";
    void requestJson<{ restored: boolean; backupName: string; restarting?: boolean }>(ApiEndpoint.BackupRestore, {
      method: "POST",
      body: JSON.stringify({ backupName })
    })
      .then(async () => {
        await finishRestoreReconnect(summary);
      })
      .catch(async (error: unknown) => {
        if (error instanceof TypeError) {
          await finishRestoreReconnect(summary);
          return;
        }
        summary.className = "error-summary";
        summary.hidden = false;
        summary.innerHTML = `<h2>There is a problem</h2><p>${escapeHtml(errorMessage(error))}</p>`;
        setBackupControlsDisabled(false);
        summary.focus();
      });
  });
}

async function finishRestoreReconnect(summary: HTMLElement): Promise<void> {
  summary.className = "notice";
  summary.hidden = false;
  summary.innerHTML = "<h2>Reconnecting…</h2><p>Waiting for the server to come back.</p>";
  const reachable = await waitUntilServerReachable();
  if (!reachable) {
    summary.className = "error-summary";
    summary.hidden = false;
    summary.innerHTML =
      "<h2>There is a problem</h2><p>Could not reconnect to the server. Refresh the page when it is available.</p>";
    setBackupControlsDisabled(false);
    summary.focus();
    return;
  }
  try {
    await refreshBackupList(summary);
  } catch {
  }
  setBackupControlsDisabled(false);
  summary.className = "notice";
  summary.hidden = false;
  summary.innerHTML = "<h2>Backup restored</h2><p>The mail store and storage key are in place again.</p>";
  summary.focus();
}

async function renderSettings(saved = false): Promise<void> {
  const generation = currentRouteGeneration();
  const [payload, summary, backupsPayload] = await Promise.all([
    requestJson<{ settings: ServerSettings }>(ApiEndpoint.Settings),
    requestJson<ActivitySummary>(ApiEndpoint.ActivitySummary),
    requestJson<{ backups: string[] }>(ApiEndpoint.Backup)
  ]);
  if (applicationState.bootstrap) {
    applicationState.bootstrap.hosting = summary.hosting;
  }
  const settings = payload.settings;
  const relay = settings.relay;
  const secureRelaySelected = relay.port === ServerPort.SmtpSecure && relay.security === "tls";
  const limits = settings.limits;
  const messageMegabytes = limits ? Math.round(limits.maximumMessageBytes / (1024 * 1024)) : 25;
  const quotaMegabytes = limits ? Math.round(limits.mailboxQuotaBytes / (1024 * 1024)) : 1024;
  const savedNotice = saved
    ? `<div class="notice"><h2>Settings saved</h2><p>The public name and relay apply now.</p></div>`
    : "";
  replaceMainContent(`
    <header class="page-header"><div><p class="eyebrow">Configuration</p><h1>Settings</h1></div></header>
    ${savedNotice}
    <section class="card stack-card" id="certificate-card">
      <h2>Certificate</h2>
      <div id="certificate-summary" class="error-summary" tabindex="-1" hidden></div>
      ${fold(
        "Certificate details",
        `<div id="certificate-details"><p class="hint">Loading the current certificate.</p></div>`,
        true
      )}
      <p class="hint">The web console on port ${ServerPort.Web} uses this certificate. Upload a PEM certificate and private key to replace it.</p>
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
        <p class="hint">Upload the PEM certificate and private key. Add the intermediate file if you have one. Mail uses them immediately.</p>
        <div class="form-actions">
          <button id="certificate-cancel" class="quiet-button" type="button">Cancel</button>
          <button class="primary-button" type="submit">Upload</button>
        </div>
      </form>
    </dialog>
    ${renderDnsRecords(summary.hosting)}
    <form id="settings-form" class="card">
      <div id="settings-summary" class="error-summary" tabindex="-1" hidden></div>
      ${fold(
        "Public name",
        `<label for="settings-hostname">Hostname</label>
      <input id="settings-hostname" value="${escapeHtml(settings.publicHostname)}" placeholder="mail.example.com">
      <p class="hint">Used in the mail greeting and DNS guide. Leave empty to use the company domain.</p>`,
        false,
        "settings-public-name"
      )}
      ${fold(
        "Storage limits",
        `<label for="settings-message-megabytes">Maximum message size in megabytes</label>
      <input id="settings-message-megabytes" type="number" min="1" max="48" value="${messageMegabytes}">
      <label for="settings-quota-megabytes">Mailbox quota in megabytes</label>
      <input id="settings-quota-megabytes" type="number" min="1" value="${quotaMegabytes}">
      <label for="settings-connection-limit">Unauthenticated mail connections</label>
      <input id="settings-connection-limit" type="number" min="1" max="500" value="${limits?.maximumUnauthenticatedConnections ?? 20}">
      <label for="settings-message-limit">Unauthenticated messages per connection</label>
      <input id="settings-message-limit" type="number" min="1" max="1000" value="${limits?.maximumUnauthenticatedMessages ?? 20}">`,
        false,
        "settings-storage-limits"
      )}
      ${fold(
        `Outgoing relay<span class="fold-status">${relay.enabled ? "On" : "Off"}</span>`,
        `<label class="choice" for="settings-relay-enabled"><input id="settings-relay-enabled" type="checkbox" ${relay.enabled ? "checked" : ""}> Send external mail through a relay</label>
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
      <input id="settings-relay-password" type="password" autocomplete="new-password" placeholder="${relay.passwordSaved ? "Saved. Enter a new password to replace it." : ""}">`,
        relay.enabled,
        "settings-outgoing-relay"
      )}
      <div class="form-actions"><button class="primary-button" type="submit">Save settings</button></div>
    </form>
    <section class="card stack-card" id="backup-card">
      <h2>Backup</h2>
      <div id="backup-summary" class="error-summary" tabindex="-1" hidden></div>
      ${fold(
        "Create and restore",
        `<div class="form-actions"><button id="create-backup" class="quiet-button" type="button">Create backup</button></div>
      <div id="backup-list-host"></div>
      <p class="hint">Restore replaces the mail store and storage key. The server restarts briefly to finish.</p>
      <div class="form-actions">
        <button id="delete-backup" class="danger-button" type="button" disabled>Delete</button>
        <button id="restore-backup" class="caution-button" type="button" disabled>Restore</button>
      </div>`,
        false,
        "settings-backup"
      )}
    </section>
    <dialog id="backup-restore-dialog" class="modal" aria-labelledby="backup-restore-dialog-title">
      <h2 id="backup-restore-dialog-title">Restore this backup?</h2>
      <p>This replaces the mail store and storage key. The server restarts briefly; the console reconnects when it is ready.</p>
      <div class="form-actions">
        <button id="backup-restore-cancel" class="quiet-button" type="button">Cancel</button>
        <button id="backup-restore-confirm" class="caution-button" type="button">Restore</button>
      </div>
    </dialog>
    <dialog id="backup-delete-dialog" class="modal" aria-labelledby="backup-delete-dialog-title">
      <h2 id="backup-delete-dialog-title">Delete this backup?</h2>
      <p>This permanently removes the selected server backup. The live mail store is not changed.</p>
      <div class="form-actions">
        <button id="backup-delete-cancel" class="quiet-button" type="button">Cancel</button>
        <button id="backup-delete-confirm" class="danger-button" type="button">Delete</button>
      </div>
    </dialog>
    ${fold("Listeners", listenerList(summary.listeners, summary.publicPorts), false, "settings-listeners")}`, generation, currentRouteGeneration());  if (generation !== currentRouteGeneration()) {
    return;
  }
  element<HTMLFormElement>("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSettings();
  });
  bindCertificateCard();
  bindBackupCard(backupsPayload.backups || []);
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
