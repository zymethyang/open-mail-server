import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { requestJson } from "../../http/jsonClient.js";
import type { MailboxPerson } from "../../interfaces/models.js";
import type { Page } from "../../interfaces/page.js";
import { navigateTo } from "../../session/pathNavigation.js";
import { applicationState } from "../../state/applicationState.js";
import { element, optionalElement } from "../../utils/element.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { errorMessage } from "../../utils/errorMessage.js";
import { iconLabel } from "../../utils/buttonIcon.js";
import { clearFormErrors, replaceMainContent, showFormError } from "../../utils/formFeedback.js";
import { currentRouteGeneration } from "../../state/routeGeneration.js";
import { presentName } from "../../utils/presentation.js";

function signInButton(person: MailboxPerson, people: MailboxPerson[]): string {
  if (person.disabled) {
    return `<button id="enable-user" class="quiet-button" type="button">${iconLabel("enableSignIn", "Enable sign-in")}</button>`;
  }
  const signedInAddress = applicationState.bootstrap?.account?.address || "";
  const anotherActiveAdministrator = people.some(
    (mailbox) => mailbox.address !== person.address && mailbox.role === "administrator" && !mailbox.disabled
  );
  const cannotDisable = person.address === signedInAddress || (person.role === "administrator" && !anotherActiveAdministrator);
  return `<button id="disable-user" class="danger-button" type="button"${cannotDisable ? " disabled" : ""}>${iconLabel("disableSignIn", "Disable sign-in")}</button>`;
}

function filteredPeople(people: MailboxPerson[]): MailboxPerson[] {
  const query = applicationState.userQuery.trim().toLowerCase();
  return people.filter((person) => {
    const matchesQuery = !query || `${person.displayName} ${person.address}`.toLowerCase().includes(query);
    const matchesStatus = applicationState.userStatus === "" || (applicationState.userStatus === "disabled" ? person.disabled : !person.disabled);
    return matchesQuery && matchesStatus;
  });
}

function userRows(people: MailboxPerson[]): string {
  if (!people.length) {
    const message = applicationState.userQuery || applicationState.userStatus ? "No users match this filter." : "Add the first user for this company.";
    return `<tr><td colspan="5"><div class="empty"><h2>No users</h2><p>${message}</p></div></td></tr>`;
  }
  return people
    .map((person) => {
      const role = person.role === "administrator" ? "Administrator" : "Member";
      return `<tr><td>${escapeHtml(person.displayName)}</td><td>${escapeHtml(person.address)}</td><td>${role}</td><td class="${person.disabled ? "status-disabled" : "status accepted"}">${person.disabled ? "Disabled" : "Active"}</td><td><button class="quiet-button" type="button" data-manage="${escapeHtml(person.address)}">${iconLabel("edit", "Edit")}</button></td></tr>`;
    })
    .join("");
}

function bindUserRows(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-manage]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(`/admin/users/${encodeURIComponent(button.dataset.manage || "")}`);
    });
  });
}

export const userDirectoryPage: Page = {
  matches(route, role) {
    return role === "administrator" && (route === "users" || route === "mailboxes");
  },
  async render() {
    const generation = currentRouteGeneration();
    const payload = await requestJson<{ mailboxes: MailboxPerson[] }>(ApiEndpoint.Mailboxes);
    const visible = filteredPeople(payload.mailboxes);
    const domain = applicationState.bootstrap?.organization?.domain || "";
    replaceMainContent(`
      <header class="page-header"><div><p class="eyebrow">${escapeHtml(domain)}</p><h1>User management</h1></div><button id="add-user" class="primary-button" type="button">${iconLabel("addUser", "Add user")}</button></header>
      <div class="filters user-filters">
        <div><label for="user-search">Email</label><input id="user-search" type="search" value="${escapeHtml(applicationState.userQuery)}" placeholder="Filter by email" autocomplete="off"></div>
        <div><label for="user-status">Status</label><select id="user-status">
          <option value="" ${applicationState.userStatus === "" ? "selected" : ""}>All</option>
          <option value="active" ${applicationState.userStatus === "active" ? "selected" : ""}>Active</option>
          <option value="disabled" ${applicationState.userStatus === "disabled" ? "selected" : ""}>Disabled</option>
        </select></div>
      </div>
      <div class="table-wrap"><table><caption class="visually-hidden">Company users</caption><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody id="user-rows">${userRows(visible)}</tbody></table></div>`, generation, currentRouteGeneration());
    if (generation !== currentRouteGeneration()) {
      return;
    }
    const search = element<HTMLInputElement>("#user-search");
    const status = element<HTMLSelectElement>("#user-status");
    const paint = () => {
      applicationState.userQuery = search.value;
      applicationState.userStatus = status.value;
      element("#user-rows").innerHTML = userRows(filteredPeople(payload.mailboxes));
      bindUserRows();
    };
    search.addEventListener("input", paint);
    status.addEventListener("change", paint);
    element("#add-user").addEventListener("click", () => {
      navigateTo("/admin/users/new");
    });
    bindUserRows();
  }
};

async function updateUser(changeAccess: boolean, disabled = false): Promise<void> {
  const form = element<HTMLFormElement>("#manage-form");
  const summary = element<HTMLElement>("#manage-summary");
  clearFormErrors(form, summary);
  const address = element<HTMLInputElement>("#manage-address").value;
  try {
    if (changeAccess) {
      await requestJson(ApiEndpoint.MailboxAccess, { method: "POST", body: JSON.stringify({ address, disabled }) });
      await renderUserEditor(address, disabled ? "Sign-in is disabled." : "Sign-in is enabled.");
      return;
    }
    const password = element<HTMLInputElement>("#manage-password").value;
    if (password.length < 8) {
      showFormError(form, summary, "Password must be 8 to 200 characters.", "manage-password");
      return;
    }
    await requestJson(ApiEndpoint.MailboxPassword, { method: "POST", body: JSON.stringify({ address, password }) });
    await renderUserEditor(address, "The password was updated.");
  } catch (error) {
    showFormError(form, summary, errorMessage(error), changeAccess ? "" : "manage-password");
  }
}

async function renderUserEditor(address: string, notice = ""): Promise<void> {
  const generation = currentRouteGeneration();
  const payload = await requestJson<{ mailboxes: MailboxPerson[] }>(ApiEndpoint.Mailboxes);
  const people = payload.mailboxes;
  const creating = !address;
  const selected = creating ? null : people.find((person) => person.address === address) || null;
  if (!creating && !selected) {
    replaceMainContent(`
      <header class="page-header"><div><p class="eyebrow">User management</p><h1>User not found</h1></div><button id="back-users" class="quiet-button" type="button">${iconLabel("back", "Back to users")}</button></header>
      <p>That mailbox is not on this server.</p>`, generation, currentRouteGeneration());
    if (generation !== currentRouteGeneration()) {
      return;
    }
    element("#back-users").addEventListener("click", () => {
      navigateTo("/admin/users");
    });
    return;
  }
  const domain = applicationState.bootstrap?.organization?.domain || "";
  const savedNotice = notice ? `<div class="notice"><h2>Saved</h2><p>${escapeHtml(notice)}</p></div>` : "";
  const body = creating
    ? `<form id="user-form" class="card detail-card"><div id="user-summary" class="error-summary" tabindex="-1" hidden></div>
      <label for="user-name">Name</label><input id="user-name" autocomplete="name" required maxlength="80">
      <label for="user-address">Email address</label><input id="user-address" autocomplete="off" required placeholder="person@${escapeHtml(domain)}">
      <label for="user-password">Password</label><input id="user-password" type="password" autocomplete="new-password" required minlength="8">
      <p class="hint">Must use ${escapeHtml(domain)}. Password also applies to SMTP, IMAP, and POP3.</p>
      <div class="form-actions"><button class="primary-button" type="submit">Create user</button><button id="cancel-user" class="quiet-button" type="button">Cancel</button></div>
    </form>`
    : `<form id="manage-form" class="card detail-card"><h2>${escapeHtml(presentName(selected?.displayName) || selected?.address || "")}</h2>${savedNotice}<div id="manage-summary" class="error-summary" tabindex="-1" hidden></div>
      <dl class="record-list">
        <div><dt>Email</dt><dd>${escapeHtml(selected?.address || "")}</dd></div>
        <div><dt>Role</dt><dd>${selected?.role === "administrator" ? "Administrator" : "Member"}</dd></div>
        <div><dt>Status</dt><dd class="${selected?.disabled ? "status-disabled" : ""}">${selected?.disabled ? "Disabled" : "Active"}</dd></div>
      </dl>
      <label for="manage-password">New password</label><input id="manage-password" type="password" autocomplete="new-password" minlength="8">
      <p class="hint">Leave password blank to keep it. Disable blocks web, SMTP, IMAP, and POP3.</p>
      <input id="manage-address" type="hidden" value="${escapeHtml(selected?.address || "")}">
      <div class="form-actions"><button class="primary-button" type="submit">${iconLabel("savePassword", "Save password")}</button>${selected ? signInButton(selected, people) : ""}<button id="cancel-user" class="quiet-button" type="button">${iconLabel("back", "Back to users")}</button></div>
    </form>`;
  replaceMainContent(`
    <header class="page-header"><div><p class="eyebrow">User management</p><h1>${creating ? "Add a user" : "Edit user"}</h1></div><button id="back-users" class="quiet-button" type="button">${iconLabel("back", "Back to users")}</button></header>
    ${body}`, generation, currentRouteGeneration());
  if (generation !== currentRouteGeneration()) {
    return;
  }
  const back = () => {
    navigateTo("/admin/users");
  };
  element("#back-users").addEventListener("click", back);
  element("#cancel-user").addEventListener("click", back);
  optionalElement<HTMLFormElement>("#user-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const summary = element<HTMLElement>("#user-summary");
    clearFormErrors(form, summary);
    try {
      await requestJson(ApiEndpoint.Mailboxes, {
        method: "POST",
        body: JSON.stringify({
          displayName: element<HTMLInputElement>("#user-name").value,
          address: element<HTMLInputElement>("#user-address").value,
          password: element<HTMLInputElement>("#user-password").value
        })
      });
      navigateTo("/admin/users");
    } catch (error) {
      showFormError(form, summary, errorMessage(error), "user-address");
    }
  });
  document.querySelector("#manage-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await updateUser(false);
  });
  document.querySelector("#disable-user")?.addEventListener("click", () => {
    void updateUser(true, true);
  });
  document.querySelector("#enable-user")?.addEventListener("click", () => {
    void updateUser(true, false);
  });
  document.querySelector<HTMLInputElement>("#user-name")?.focus();
}

export const userEditorPage: Page = {
  matches(route, role) {
    return role === "administrator" && (route === "users/new" || route.startsWith("users/"));
  },
  async render(route) {
    const address = route === "users/new" ? "" : decodeURIComponent(route.slice("users/".length));
    await renderUserEditor(address);
  }
};
