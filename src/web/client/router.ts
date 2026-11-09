import type { Page } from "./interfaces/page.js";
import { attentionPage } from "./components/attention/index.js";
import { failedEmailPage } from "./components/failedEmail/index.js";
import { logsPage } from "./components/logs/index.js";
import { mailboxPage } from "./components/mailbox/index.js";
import { renderNavigation } from "./components/navigation/index.js";
import { overviewPage } from "./components/overview/index.js";
import { securityPage } from "./components/security/index.js";
import { settingsPage } from "./components/settings/index.js";
import { userDirectoryPage, userEditorPage } from "./components/users/index.js";
import { canOpenRoute, homeHash } from "./session/consoleAccess.js";
import { applicationState } from "./state/applicationState.js";
import { currentRouteGeneration, startRoute } from "./state/routeGeneration.js";
import { escapeHtml } from "./utils/escapeHtml.js";
import { errorMessage } from "./utils/errorMessage.js";
import { replaceMainContent } from "./utils/formFeedback.js";

const pages: Page[] = [attentionPage, failedEmailPage, logsPage, userEditorPage, userDirectoryPage, settingsPage, securityPage, mailboxPage, overviewPage];

export async function renderRoute(): Promise<void> {
  const generation = startRoute();
  const account = applicationState.bootstrap?.account;
  if (!account) {
    return;
  }
  renderNavigation();
  const route = (location.hash || homeHash(account.role)).replace(/^#/, "");
  if (!canOpenRoute(route, account.role)) {
    const home = homeHash(account.role);
    if (location.hash !== home) {
      location.hash = home;
    }
    return;
  }
  for (const page of pages) {
    if (page.matches(route, account.role)) {
      try {
        await page.render(route);
      } catch (error: unknown) {
        replaceMainContent(
          `<div class="empty"><h2>Something went wrong</h2><p>${escapeHtml(errorMessage(error))}</p></div>`,
          generation,
          currentRouteGeneration()
        );
      }
      return;
    }
  }
  if (generation === currentRouteGeneration()) {
    location.hash = homeHash(account.role);
  }
}

export function bindRouteChanges(): void {
  window.addEventListener("hashchange", () => {
    void renderRoute();
  });
}
