import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { requestJson } from "../../http/jsonClient.js";
import type { ActivityDay, ActivitySummary, MailClientSettings } from "../../interfaces/models.js";
import type { Page } from "../../interfaces/page.js";
import { applicationState } from "../../state/applicationState.js";
import { currentPathName } from "../../session/pathNavigation.js";
import { isAdminPath, isOverviewPath } from "../../session/consoleAccess.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { replaceMainContent } from "../../utils/formFeedback.js";
import { currentRouteGeneration } from "../../state/routeGeneration.js";
import { fold } from "../../utils/presentation.js";
import { drawMailChart } from "./mailChart.js";
import { renderMailClientSettingsCard } from "./hosting.js";

export const overviewPage: Page = {
  matches(route, role) {
    return role === "administrator" && isAdminPath(currentPathName()) && (route === "overview" || route.startsWith("overview/"));
  },
  async render() {
    const generation = currentRouteGeneration();
    const summary = await requestJson<ActivitySummary>(ApiEndpoint.ActivitySummary);
    const today: ActivityDay = summary.days[summary.days.length - 1] || { date: "", delivered: 0, failed: 0, sent: 0, rejected: 0 };
    replaceMainContent(`
      <header class="page-header"><div><p class="eyebrow">${escapeHtml(summary.organization?.domain || "")}</p><h1>Overview</h1></div></header>
      <section class="metric-grid" aria-label="Today">
        <article class="card metric"><span>Users</span><strong>${summary.mailboxCount}</strong></article>
        <article class="card metric"><span>Delivered today</span><strong>${today.delivered || 0}</strong></article>
        <article class="card metric"><span>Sent today</span><strong>${today.sent || 0}</strong></article>
        <a class="card metric metric-link" href="/admin/attention"><span>Needs attention</span><strong>${summary.attention ?? (today.failed || 0) + (today.rejected || 0) + summary.queued}</strong><span class="muted">${summary.queued} waiting to retry</span><span class="metric-action">View details and reset</span></a>
      </section>
      ${fold("Last 14 days", `<div id="mail-chart" class="mail-chart"></div>`, true)}`, generation, currentRouteGeneration());
    if (generation === currentRouteGeneration()) {
      drawMailChart(summary.days);
    }
  }
};

export const memberOverviewPage: Page = {
  matches(route) {
    return isOverviewPath(currentPathName()) && (route === "overview" || route.startsWith("overview/"));
  },
  async render() {
    const generation = currentRouteGeneration();
    const payload = await requestJson<{ clients: MailClientSettings }>(ApiEndpoint.MailClientSettings);
    const domain = applicationState.bootstrap?.organization?.domain || "";
    replaceMainContent(`
      <header class="page-header"><div><p class="eyebrow">${escapeHtml(domain)}</p><h1>Overview</h1></div></header>
      ${renderMailClientSettingsCard(payload.clients)}`, generation, currentRouteGeneration());
  }
};
