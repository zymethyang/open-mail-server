import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { ServerPort } from "../../enums/serverPort.js";
import { requestJson } from "../../http/jsonClient.js";
import type { ActivityEvent } from "../../interfaces/models.js";
import type { Page } from "../../interfaces/page.js";
import { element } from "../../utils/element.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { replaceMainContent } from "../../utils/formFeedback.js";
import { currentRouteGeneration } from "../../state/routeGeneration.js";

async function loadLogs(): Promise<void> {
  const search = document.querySelector<HTMLInputElement>("#log-search");
  const protocol = document.querySelector<HTMLSelectElement>("#log-protocol");
  const result = document.querySelector<HTMLSelectElement>("#log-result");
  if (!search || !protocol || !result) {
    return;
  }
  const parameters = new URLSearchParams({
    search: search.value,
    protocol: protocol.value,
    result: result.value
  });
  const payload = await requestJson<{ events: ActivityEvent[] }>(`${ApiEndpoint.Activity}?${parameters.toString()}`);
  const target = document.querySelector<HTMLElement>("#log-table");
  if (!target) {
    return;
  }
  if (!payload.events.length) {
    target.innerHTML = `<div class="empty"><h2>No matching log entries</h2><p>Mail received on port ${ServerPort.Smtp} and mail sent by signed-in users will appear here.</p></div>`;
    return;
  }
  const rows = payload.events
    .map((event) => `<tr><td>${escapeHtml(new Date(event.occurredAt).toLocaleString())}</td><td>${escapeHtml(event.protocol)}</td><td class="status ${escapeHtml(event.result)}">${escapeHtml(event.result)}</td><td>${escapeHtml(event.senderAddress)}</td><td>${escapeHtml(event.recipientAddresses.join(", "))}</td><td>${escapeHtml(event.subject)}</td><td>${escapeHtml(event.detail)}</td></tr>`)
    .join("");
  target.innerHTML = `<div class="table-wrap"><table><caption class="visually-hidden">Email activity</caption><thead><tr><th>Time</th><th>Protocol</th><th>Result</th><th>Sender</th><th>Recipients</th><th>Subject</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export const logsPage: Page = {
  matches(route, role) {
    return route.startsWith("logs") && role === "administrator";
  },
  async render() {
    const generation = currentRouteGeneration();
    replaceMainContent(`
      <header class="page-header"><div><p class="eyebrow">Audit</p><h1>Email logs</h1></div></header>
      <form id="log-filter" class="filters">
        <div><label for="log-search">Search sender, recipient, or subject</label><input id="log-search" type="search"></div>
        <div><label for="log-protocol">Protocol</label><select id="log-protocol"><option value="">All</option><option>smtp</option><option>imap</option><option>pop3</option><option>web</option></select></div>
        <div><label for="log-result">Result</label><select id="log-result"><option value="">All</option><option>delivered</option><option>accepted</option><option>queued</option><option>failed</option><option>rejected</option></select></div>
        <button class="quiet-button" type="submit">Apply</button>
      </form>
      <div id="log-table"></div>`, generation, currentRouteGeneration());
    if (generation !== currentRouteGeneration()) {
      return;
    }
    element<HTMLFormElement>("#log-filter").addEventListener("submit", (event) => {
      event.preventDefault();
      void loadLogs();
    });
    await loadLogs();
  }
};
