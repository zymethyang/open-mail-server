import type { Page } from "./interfaces/page.js";
import { addressDirectoryPage } from "./components/addresses/index.js";
import { attentionPage } from "./components/attention/index.js";
import { failedEmailPage } from "./components/failedEmail/index.js";
import { logsPage } from "./components/logs/index.js";
import { mailboxPage } from "./components/mailbox/index.js";
import { renderNavigation } from "./components/navigation/index.js";
import { memberOverviewPage, overviewPage } from "./components/overview/index.js";
import { securityPage } from "./components/security/index.js";
import { settingsPage } from "./components/settings/index.js";
import { userDirectoryPage, userEditorPage } from "./components/users/index.js";
import {
  canOpenRoute,
  homePath,
  isAdminPath,
  isOverviewPath,
  normalizeConsolePath,
  routeKey,
  shellModeForPath
} from "./session/consoleAccess.js";
import { bindPathRenderer, currentPathName, navigateTo, syncLegacyHashRoute } from "./session/pathNavigation.js";
import { applicationState } from "./state/applicationState.js";
import { currentRouteGeneration, startRoute } from "./state/routeGeneration.js";
import { escapeHtml } from "./utils/escapeHtml.js";
import { errorMessage } from "./utils/errorMessage.js";
import { replaceMainContent } from "./utils/formFeedback.js";

const pages: Page[] = [attentionPage, failedEmailPage, logsPage, userEditorPage, userDirectoryPage, addressDirectoryPage, settingsPage, securityPage, mailboxPage, memberOverviewPage, overviewPage];

function showUnauthorizedAdmin(): void {
  const generation = currentRouteGeneration();
  replaceMainContent(
    `<div class="empty"><p class="eyebrow">Access</p><h1>Administrator access required</h1><p>You cannot open the Admin portal.</p><p><a class="primary-button" href="/mailbox">Go to mailbox</a></p></div>`,
    generation,
    currentRouteGeneration()
  );
}

export async function renderRoute(): Promise<void> {
  const generation = startRoute();
  const account = applicationState.bootstrap?.account;
  if (!account) {
    return;
  }
  const pathName = currentPathName();
  applicationState.shellMode = shellModeForPath(pathName, account.role, applicationState.shellMode);
  renderNavigation();
  if (pathName === "/" || pathName === "") {
    navigateTo(homePath(account.role), true);
    return;
  }
  if (isAdminPath(pathName) && account.role !== "administrator") {
    showUnauthorizedAdmin();
    return;
  }
  if (!canOpenRoute(pathName, account.role)) {
    navigateTo(homePath(account.role), true);
    return;
  }
  const route = routeKey(pathName);
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
    navigateTo(homePath(account.role), true);
  }
}

export function bindRouteChanges(): void {
  bindPathRenderer(renderRoute);
  window.addEventListener("popstate", () => {
    void renderRoute();
  });
  window.addEventListener("hashchange", () => {
    if (!location.hash) {
      return;
    }
    syncLegacyHashRoute();
    void renderRoute();
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest("a");
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (anchor.target && anchor.target !== "_self") {
      return;
    }
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("http:") || href.startsWith("https:")) {
      return;
    }
    const url = new URL(href, location.origin);
    if (url.origin !== location.origin) {
      return;
    }
    const pathName = normalizeConsolePath(url.pathname);
    if (!(isAdminPath(pathName) || isOverviewPath(pathName) || pathName === "/mailbox" || pathName.startsWith("/mailbox/") || pathName === "/account")) {
      return;
    }
    event.preventDefault();
    navigateTo(pathName);
  });
}
