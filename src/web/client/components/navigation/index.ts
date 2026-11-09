import { homeHash, navigationEntries } from "../../session/consoleAccess.js";
import { applicationState } from "../../state/applicationState.js";
import { iconLabel } from "../../utils/buttonIcon.js";
import { element } from "../../utils/element.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

export function renderNavigation(): void {
  const role = applicationState.bootstrap?.account?.role || "";
  const current = location.hash || homeHash(role);
  const navigation = element("#primary-navigation");
  const items = navigationEntries(role);
  const existing = [...navigation.querySelectorAll<HTMLAnchorElement>("a.nav-link")];
  const sameItems = existing.length === items.length && existing.every((link, index) => link.getAttribute("href") === items[index].href);
  if (!sameItems) {
    navigation.innerHTML = items
      .map((item) => `<a class="nav-link" href="${item.href}"><img class="nav-icon" src="${escapeHtml(item.iconPath)}" alt=""><span>${escapeHtml(item.label)}</span></a>`)
      .join("");
  }
  navigation.querySelectorAll<HTMLAnchorElement>("a.nav-link").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (current === href || current.startsWith(`${href}/`)) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
  const securityButton = element("#password-button");
  if (!securityButton.querySelector("svg")) {
    securityButton.innerHTML = iconLabel("security", "Security");
    element("#sign-out-button").innerHTML = iconLabel("signOut", "Sign out");
  }
  element("#organization-label").textContent = applicationState.bootstrap?.organization?.displayName || "Company";
  element("#account-label").textContent = applicationState.bootstrap?.account?.address || "";
}

export function bindShellActions(signOut: () => Promise<void>): void {
  element("#password-button").addEventListener("click", () => {
    location.hash = "#account";
  });
  element("#sign-out-button").addEventListener("click", () => {
    void signOut();
  });
}
