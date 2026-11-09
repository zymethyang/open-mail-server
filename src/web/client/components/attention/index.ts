import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { requestJson } from "../../http/jsonClient.js";
import type { ActivityEvent, FailedEmail } from "../../interfaces/models.js";
import type { Page } from "../../interfaces/page.js";
import { element } from "../../utils/element.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { errorMessage } from "../../utils/errorMessage.js";
import { replaceMainContent } from "../../utils/formFeedback.js";
import { currentRouteGeneration } from "../../state/routeGeneration.js";

let recordedProblems: ActivityEvent[] = [];

function presentTime(value: string): string {
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? value : when.toLocaleString();
}

function detailRows(event: ActivityEvent): string {
  const recipients = (event.recipientAddresses || []).join(", ");
  const rows = [
    ["Time", presentTime(event.occurredAt)],
    ["Result", event.result],
    ["Protocol", event.protocol],
    ["Action", event.action || ""],
    ["Sender", event.senderAddress],
    ["Recipients", recipients],
    ["Mailbox", event.mailboxAddress || ""],
    ["Subject", event.subject],
    ["Remote address", event.remoteAddress || ""],
    ["Size", event.byteCount ? `${event.byteCount} bytes` : ""],
    ["Detail", event.detail]
  ];
  return rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
}

function showProblem(index: number): void {
  const event = recordedProblems[index];
  const detail = element<HTMLElement>("#attention-detail");
  if (!event) {
    detail.hidden = true;
    detail.innerHTML = "";
    return;
  }
  detail.hidden = false;
  detail.innerHTML = `<h2>Problem detail</h2><dl class="record-list">${detailRows(event)}</dl>`;
  detail.focus();
}

function eventRows(events: ActivityEvent[]): string {
  if (!events.length) {
    return `<div class="empty"><h2>No recorded problems</h2><p>Failed, rejected, and queued mail from today appears here until the counter is reset.</p></div>`;
  }
  const rows = events
    .map((event, index) => {
      const recipients = (event.recipientAddresses || []).join(", ");
      return `<tr>
        <td>${escapeHtml(presentTime(event.occurredAt))}</td>
        <td class="status ${escapeHtml(event.result)}">${escapeHtml(event.result)}</td>
        <td>${escapeHtml(event.senderAddress)}</td>
        <td>${escapeHtml(recipients)}</td>
        <td>${escapeHtml(event.subject)}</td>
        <td>${escapeHtml(event.detail)}</td>
        <td><button class="quiet-button" type="button" data-attention-event="${index}">View</button></td>
      </tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table><caption class="visually-hidden">Problems that need attention</caption><thead><tr><th>Time</th><th>Result</th><th>Sender</th><th>Recipients</th><th>Subject</th><th>Detail</th><th>Detail view</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function waitingRows(messages: FailedEmail[]): string {
  if (!messages.length) {
    return `<div class="empty"><h2>Nothing is waiting</h2><p>Outbound mail that could not leave this server is listed on Failed email.</p></div>`;
  }
  const rows = messages
    .map((message) => {
      return `<tr><td>${escapeHtml(presentTime(message.nextAttemptAt))}</td><td>${escapeHtml(message.senderAddress)}</td><td>${escapeHtml(message.recipientAddresses.join(", "))}</td><td>${escapeHtml(message.subject)}</td><td>${message.attempts}</td><td>${escapeHtml(message.lastError)}</td></tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table><caption class="visually-hidden">Mail waiting to retry</caption><thead><tr><th>Next attempt</th><th>Sender</th><th>Recipients</th><th>Subject</th><th>Attempts</th><th>Last error</th></tr></thead><tbody>${rows}</tbody></table></div><p class="hint"><a href="#failed-email">Open failed email</a> to resend this mail.</p>`;
}

function bindAttention(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-attention-event]").forEach((button) => {
    button.addEventListener("click", () => {
      showProblem(Number(button.dataset.attentionEvent || ""));
    });
  });
  element<HTMLButtonElement>("#reset-attention").addEventListener("click", () => {
    void resetAttention();
  });
}

async function renderAttention(notice = ""): Promise<void> {
  const generation = currentRouteGeneration();
  const payload = await requestJson<{ events: ActivityEvent[]; messages: FailedEmail[] }>(ApiEndpoint.ActivityAttention);
  if (generation !== currentRouteGeneration()) {
    return;
  }
  recordedProblems = payload.events || [];
  const noticeMarkup = notice
    ? `<div id="attention-summary" class="notice" tabindex="-1"><h2>Counter reset</h2><p>${escapeHtml(notice)}</p></div>`
    : `<div id="attention-summary" class="notice" tabindex="-1" hidden></div>`;
  replaceMainContent(
    `<header class="page-header">
      <div><p class="eyebrow">Overview</p><h1>Needs attention</h1></div>
      <button id="reset-attention" class="quiet-button" type="button">Reset counter</button>
    </header>
    ${noticeMarkup}
    <section id="attention-detail" class="card stack-card" tabindex="-1" hidden></section>
    <section class="stack-card"><h2>Recorded problems</h2><div id="attention-events">${eventRows(recordedProblems)}</div></section>
    <section class="stack-card"><h2>Waiting to retry</h2><div id="attention-waiting">${waitingRows(payload.messages || [])}</div></section>`,
    generation,
    currentRouteGeneration()
  );
  if (generation !== currentRouteGeneration()) {
    return;
  }
  bindAttention();
}

async function resetAttention(): Promise<void> {
  const button = element<HTMLButtonElement>("#reset-attention");
  const summary = element<HTMLElement>("#attention-summary");
  button.disabled = true;
  try {
    await requestJson(ApiEndpoint.ActivityAttentionReset, { method: "POST", body: "{}" });
    await renderAttention("Today's recorded problems no longer add to Needs attention. Mail that is still waiting to retry stays listed.");
  } catch (error) {
    summary.className = "error-summary";
    summary.hidden = false;
    summary.innerHTML = `<h2>There is a problem</h2><p>${escapeHtml(errorMessage(error))}</p>`;
    button.disabled = false;
  }
}

export const attentionPage: Page = {
  matches(route, role) {
    return role === "administrator" && (route === "attention" || route.startsWith("attention/"));
  },
  async render() {
    await renderAttention();
  }
};
