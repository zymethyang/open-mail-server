import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { requestJson } from "../../http/jsonClient.js";
import type { FailedEmail, FailedEmailResendResult } from "../../interfaces/models.js";
import type { Page } from "../../interfaces/page.js";
import { element } from "../../utils/element.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { errorMessage } from "../../utils/errorMessage.js";
import { iconLabel } from "../../utils/buttonIcon.js";
import { replaceMainContent } from "../../utils/formFeedback.js";
import { currentRouteGeneration } from "../../state/routeGeneration.js";
import { failedEmailNotice, resendButtonLabel, visibleFailedEmail } from "./presentation.js";

let failedMessages: FailedEmail[] = [];

function searchQuery(): string {
  return element<HTMLInputElement>("#failed-search").value.trim().toLowerCase();
}

function visibleMessages(): FailedEmail[] {
  return visibleFailedEmail(failedMessages, searchQuery());
}

function selectedIdentifiers(): string[] {
  return [...document.querySelectorAll<HTMLInputElement>(".failed-row-check:checked")].map((input) => input.value);
}

function updateResendButton(): void {
  const button = element<HTMLButtonElement>("#resend-failed");
  const visible = visibleMessages();
  const selected = selectedIdentifiers();
  button.innerHTML = iconLabel("resend", resendButtonLabel(selected.length));
  button.disabled = failedMessages.length === 0 || button.dataset.sending === "true";
  const selectAll = document.querySelector<HTMLInputElement>("#failed-select-all");
  if (!selectAll) {
    return;
  }
  selectAll.checked = visible.length > 0 && selected.length === visible.length;
  selectAll.indeterminate = selected.length > 0 && selected.length < visible.length;
  selectAll.disabled = visible.length === 0;
}

function renderTable(): void {
  const target = element("#failed-table");
  const visible = visibleMessages();
  if (!failedMessages.length) {
    target.innerHTML = `<div class="empty"><h2>No failed email</h2><p>Mail that cannot leave this server waits here until it is sent or returned to the sender.</p></div>`;
    updateResendButton();
    return;
  }
  if (!visible.length) {
    target.innerHTML = `<div class="empty"><h2>No matching failed email</h2><p>Try a different sender, recipient, or subject. Resend all still sends every failed message.</p></div>`;
    updateResendButton();
    return;
  }
  const rows = visible
    .map((message) => {
      const when = new Date(message.nextAttemptAt);
      const time = Number.isNaN(when.getTime()) ? message.nextAttemptAt : when.toLocaleString();
      return `<tr>
        <td><input class="failed-row-check" type="checkbox" value="${escapeHtml(message.identifier)}" aria-label="Select ${escapeHtml(message.subject)}"></td>
        <td>${escapeHtml(time)}</td>
        <td>${escapeHtml(message.senderAddress)}</td>
        <td>${escapeHtml(message.recipientAddresses.join(", "))}</td>
        <td>${escapeHtml(message.subject)}</td>
        <td>${message.attempts}</td>
        <td>${escapeHtml(message.lastError)}</td>
      </tr>`;
    })
    .join("");
  target.innerHTML = `<div class="table-wrap"><table><caption class="visually-hidden">Failed email</caption><thead><tr><th><input id="failed-select-all" type="checkbox" aria-label="Select all failed email"></th><th>Next attempt</th><th>Sender</th><th>Recipients</th><th>Subject</th><th>Attempts</th><th>Last error</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  element<HTMLInputElement>("#failed-select-all").addEventListener("change", () => {
    const checked = element<HTMLInputElement>("#failed-select-all").checked;
    document.querySelectorAll<HTMLInputElement>(".failed-row-check").forEach((input) => {
      input.checked = checked;
    });
    updateResendButton();
  });
  document.querySelectorAll<HTMLInputElement>(".failed-row-check").forEach((input) => {
    input.addEventListener("change", () => updateResendButton());
  });
  updateResendButton();
}

function showNotice(message: string, failed: boolean): void {
  const summary = element<HTMLElement>("#failed-summary");
  summary.className = failed ? "error-summary" : "notice";
  summary.hidden = false;
  summary.innerHTML = `<h2>${failed ? "There is a problem" : "Resend finished"}</h2><p>${escapeHtml(message)}</p>`;
}

async function loadFailedEmail(): Promise<void> {
  const payload = await requestJson<{ messages: FailedEmail[] }>(ApiEndpoint.FailedEmail);
  if (!document.querySelector("#failed-table")) {
    return;
  }
  failedMessages = payload.messages;
  renderTable();
}

async function resendFailedEmail(): Promise<void> {
  const button = element<HTMLButtonElement>("#resend-failed");
  const selected = selectedIdentifiers();
  button.dataset.sending = "true";
  button.disabled = true;
  try {
    const result = await requestJson<FailedEmailResendResult>(ApiEndpoint.FailedEmailResend, {
      method: "POST",
      body: JSON.stringify({ identifiers: selected })
    });
    button.dataset.sending = "false";
    failedMessages = result.stillWaiting;
    showNotice(failedEmailNotice(result), false);
    renderTable();
  } catch (error) {
    showNotice(errorMessage(error), true);
    button.dataset.sending = "false";
    updateResendButton();
  }
}

export const failedEmailPage: Page = {
  matches(route, role) {
    return role === "administrator" && (route === "failed-email" || route.startsWith("failed-email/"));
  },
  async render() {
    const generation = currentRouteGeneration();
    failedMessages = [];
    replaceMainContent(`
      <header class="page-header">
        <div><p class="eyebrow">Delivery</p><h1>Failed email</h1></div>
        <button id="resend-failed" class="primary-button" type="button" disabled>${iconLabel("resend", "Resend all")}</button>
      </header>
      <form id="failed-filter" class="filters failed-filters">
        <div><label for="failed-search">Search sender, recipient, or subject</label><input id="failed-search" type="search" placeholder="Filter by sender, recipient, or subject"></div>
      </form>
      <div id="failed-summary" class="notice" tabindex="-1" hidden></div>
      <div id="failed-table"></div>`, generation, currentRouteGeneration());
    if (generation !== currentRouteGeneration()) {
      return;
    }
    element<HTMLFormElement>("#failed-filter").addEventListener("submit", (event) => event.preventDefault());
    element<HTMLInputElement>("#failed-search").addEventListener("input", () => renderTable());
    element<HTMLButtonElement>("#resend-failed").addEventListener("click", () => {
      void resendFailedEmail();
    });
    await loadFailedEmail();
  }
};
