import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { requestJson } from "../../http/jsonClient.js";
import type { SessionAccount } from "../../interfaces/models.js";
import type { Page } from "../../interfaces/page.js";
import { applicationState } from "../../state/applicationState.js";
import { element, optionalElement } from "../../utils/element.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { errorMessage } from "../../utils/errorMessage.js";
import { iconLabel } from "../../utils/buttonIcon.js";
import { clearFormErrors, replaceMainContent, showFormError } from "../../utils/formFeedback.js";
import { currentRouteGeneration } from "../../state/routeGeneration.js";

interface AccountResponse {
  account: SessionAccount;
}

interface AuthenticatorSetup {
  image: string;
  secret: string;
}

function bindAuthenticator(): void {
  const start = optionalElement<HTMLButtonElement>("#authenticator-start");
  if (start) {
    start.addEventListener("click", async () => {
      const summary = element<HTMLElement>("#authenticator-summary");
      summary.className = "error-summary";
      summary.hidden = true;
      try {
        const payload = await requestJson<AuthenticatorSetup>(ApiEndpoint.AccountOneTimePassword, { method: "POST", body: "{}" });
        const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(payload.image)}`;
        element("#authenticator-setup").innerHTML = `
          <div class="authenticator-frame"><img class="authenticator-image" alt="Authenticator setup code" src="${image}"></div>
          <p class="security-copy">Scan this code, or enter the key manually. Spaces are only there to make the key easier to read.</p>
          <p class="secret-code">${escapeHtml(payload.secret.replace(/(.{4})/g, "$1 ").trim())}</p>
          <form id="authenticator-confirm">
            <label for="authenticator-code">Code from the app</label>
            <input id="authenticator-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
            <div class="form-actions"><button class="primary-button" type="submit">Confirm authenticator</button></div>
          </form>`;
        start.hidden = true;
        element<HTMLFormElement>("#authenticator-confirm").addEventListener("submit", async (event) => {
          event.preventDefault();
          try {
            const confirmed = await requestJson<AccountResponse>(ApiEndpoint.AccountOneTimePasswordConfirm, {
              method: "POST",
              body: JSON.stringify({ code: element<HTMLInputElement>("#authenticator-code").value })
            });
            if (applicationState.bootstrap) {
              applicationState.bootstrap.account = confirmed.account;
            }
            await renderPassword();
            const notice = element<HTMLElement>("#authenticator-summary");
            notice.className = "notice";
            notice.hidden = false;
            notice.innerHTML = "<h2>Authenticator is on</h2><p>The next web sign-in asks for a code after the password.</p>";
          } catch (error) {
            showFormError(element("#authenticator-confirm"), summary, errorMessage(error), "authenticator-code");
          }
        });
      } catch (error) {
        summary.hidden = false;
        summary.innerHTML = `<h2>There is a problem</h2><p>${escapeHtml(errorMessage(error))}</p>`;
      }
    });
  }
  const remove = optionalElement<HTMLFormElement>("#authenticator-remove");
  if (remove) {
    remove.addEventListener("submit", async (event) => {
      event.preventDefault();
      const summary = element<HTMLElement>("#authenticator-summary");
      summary.className = "error-summary";
      try {
        const payload = await requestJson<AccountResponse>(ApiEndpoint.AccountOneTimePasswordRemove, {
          method: "POST",
          body: JSON.stringify({
            password: element<HTMLInputElement>("#authenticator-password").value,
            code: element<HTMLInputElement>("#authenticator-remove-code").value
          })
        });
        if (applicationState.bootstrap) {
          applicationState.bootstrap.account = payload.account;
        }
        await renderPassword();
      } catch (error) {
        showFormError(remove, summary, errorMessage(error), "authenticator-password");
      }
    });
  }
}

async function renderPassword(): Promise<void> {
  const account = applicationState.bootstrap?.account;
  if (!account) {
    return;
  }
  const enabled = Boolean(account.oneTimePasswordEnabled);
  const generation = currentRouteGeneration();
  replaceMainContent(`
    <header class="page-header"><div><p class="eyebrow">${escapeHtml(account.address)}</p><h1>Security</h1></div></header>
    <form id="password-form" class="card"><div id="password-summary" class="error-summary" tabindex="-1" hidden></div>
      <h2>Password</h2>
      <input class="visually-hidden" autocomplete="username" value="${escapeHtml(account.address)}" readonly tabindex="-1">
      <label for="current-password">Current password</label><input id="current-password" type="password" autocomplete="current-password" required>
      <label for="new-password">New password</label><input id="new-password" type="password" autocomplete="new-password" required minlength="8">
      <p class="security-copy">This password is also used for SMTP, IMAP, and POP3. Other signed-in sessions for this mailbox are signed out.</p>
      <div class="form-actions"><button class="primary-button" type="submit">${iconLabel("savePassword", "Save password")}</button></div>
    </form>
    <section class="card stack-card" id="authenticator-card">
      <h2>Authenticator</h2>
      <div id="authenticator-summary" class="error-summary" tabindex="-1" hidden></div>
      <p class="security-copy">${enabled ? "An authenticator app is required after the password when you sign in on the web." : "Add an authenticator app for the web console. Mail clients keep using the password."}</p>
      <div id="authenticator-setup"></div>
      ${enabled ? `<details class="fold"><summary>Turn off authenticator</summary><form id="authenticator-remove" class="fold-body">
        <input class="visually-hidden" autocomplete="username" value="${escapeHtml(account.address)}" readonly tabindex="-1">
        <label for="authenticator-password">Current password</label><input id="authenticator-password" type="password" autocomplete="current-password" required>
        <label for="authenticator-remove-code">Authenticator code</label><input id="authenticator-remove-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
        <div class="form-actions"><button class="danger-button" type="submit">Turn off</button></div>
      </form></details>` : `<div class="form-actions"><button id="authenticator-start" class="primary-button" type="button">Set up authenticator</button></div>`}
    </section>`, generation, currentRouteGeneration());
  if (generation !== currentRouteGeneration()) {
    return;
  }
  element<HTMLFormElement>("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const summary = element<HTMLElement>("#password-summary");
    summary.className = "error-summary";
    clearFormErrors(form, summary);
    try {
      const payload = await requestJson<AccountResponse>(ApiEndpoint.AccountPassword, {
        method: "POST",
        body: JSON.stringify({
          currentPassword: element<HTMLInputElement>("#current-password").value,
          password: element<HTMLInputElement>("#new-password").value
        })
      });
      if (applicationState.bootstrap) {
        applicationState.bootstrap.account = payload.account;
      }
      summary.className = "notice";
      summary.hidden = false;
      summary.innerHTML = "<h2>Password saved</h2><p>Use the new password the next time you sign in.</p>";
      form.reset();
    } catch (error) {
      showFormError(form, summary, errorMessage(error), "current-password");
    }
  });
  bindAuthenticator();
}

export const securityPage: Page = {
  matches(route) {
    return route.startsWith("account");
  },
  async render() {
    await renderPassword();
  }
};
