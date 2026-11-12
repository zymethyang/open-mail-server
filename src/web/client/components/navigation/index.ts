import { homePath, navigationEntries } from "../../session/consoleAccess.js";
import { navigateTo } from "../../session/pathNavigation.js";
import { applicationState } from "../../state/applicationState.js";
import { iconLabel } from "../../utils/buttonIcon.js";
import { element } from "../../utils/element.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

export function renderNavigation(): void {
  const role = applicationState.bootstrap?.account?.role || "";
  const pathName = location.pathname || "/";
  const navigation = element("#primary-navigation");
  const items = navigationEntries(role, applicationState.shellMode);
  const existing = [...navigation.querySelectorAll<HTMLAnchorElement>("a.nav-link")];
  const sameItems = existing.length === items.length && existing.every((link, index) => link.getAttribute("href") === items[index].href);
  if (!sameItems) {
    navigation.innerHTML = items
      .map((item) => `<a class="nav-link" href="${item.href}"><img class="nav-icon" src="${escapeHtml(item.iconPath)}" alt=""><span>${escapeHtml(item.label)}</span></a>`)
      .join("");
  }
  navigation.querySelectorAll<HTMLAnchorElement>("a.nav-link").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (pathName === href || pathName.startsWith(`${href}/`)) {
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
  const footer = element(".sidebar-footer");
  let modeSwitch = document.querySelector<HTMLButtonElement>("#mode-switch-button");
  if (role === "administrator") {
    const label = applicationState.shellMode === "admin" ? "Open mailbox" : "Open Admin portal";
    const iconName = applicationState.shellMode === "admin" ? "openMailbox" : "openAdminPortal";
    if (!modeSwitch) {
      modeSwitch = document.createElement("button");
      modeSwitch.id = "mode-switch-button";
      modeSwitch.className = "quiet-button";
      modeSwitch.type = "button";
      footer.insertBefore(modeSwitch, securityButton);
    }
    modeSwitch.innerHTML = iconLabel(iconName, label);
    modeSwitch.hidden = false;
  } else if (modeSwitch) {
    modeSwitch.remove();
  }
  element("#organization-label").textContent = applicationState.bootstrap?.organization?.displayName || "Company";
  element("#account-label").textContent = applicationState.bootstrap?.account?.address || "";
}

export function bindShellActions(signOut: () => Promise<void>): void {
  element("#password-button").addEventListener("click", () => {
    navigateTo("/account");
  });
  element("#sign-out-button").addEventListener("click", () => {
    void signOut();
  });
  element(".sidebar-footer").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest("#mode-switch-button");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    if (applicationState.shellMode === "admin") {
      navigateTo("/mailbox");
      return;
    }
    navigateTo(homePath("administrator"));
  });
}
