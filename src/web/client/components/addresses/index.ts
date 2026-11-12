import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { requestJson } from "../../http/jsonClient.js";
import type { Page } from "../../interfaces/page.js";
import { element } from "../../utils/element.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { errorMessage } from "../../utils/errorMessage.js";
import { iconLabel } from "../../utils/buttonIcon.js";
import { clearFormErrors, replaceMainContent, showFormError } from "../../utils/formFeedback.js";
import { currentRouteGeneration } from "../../state/routeGeneration.js";
import { fold } from "../../utils/presentation.js";

interface AddressAlias {
  address: string;
  mailboxAddress: string;
}

interface AddressList {
  address: string;
  mailboxAddresses: string[];
}

interface CatchAllMailbox {
  domain: string;
  mailboxAddress: string;
}

interface AddressRoutes {
  domains: string[];
  aliases: AddressAlias[];
  lists: AddressList[];
  catchAllMailboxes: CatchAllMailbox[];
  blockedSenders: string[];
  blockedDomains: string[];
  blockedRemoteAddresses: string[];
}

interface AddressKindChrome {
  valueLabel: string;
  valuePlaceholder: string;
  targetLabel: string;
  targetPlaceholder: string;
  hint: string;
  showTarget: boolean;
}

function addressKindChrome(kind: string, companyDomain: string): AddressKindChrome {
  if (kind === "list") {
    return {
      valueLabel: "List address",
      valuePlaceholder: `team@${companyDomain}`,
      targetLabel: "Mailboxes",
      targetPlaceholder: `ada@${companyDomain}, grace@${companyDomain}`,
      hint: "Delivers to each mailbox listed (comma-separated).",
      showTarget: true
    };
  }
  if (kind === "domain") {
    return {
      valueLabel: "Domain",
      valuePlaceholder: "example.com",
      targetLabel: "Mailbox",
      targetPlaceholder: "",
      hint: "Accepts mail for this domain as well as the company domain.",
      showTarget: false
    };
  }
  if (kind === "catch-all") {
    return {
      valueLabel: "Domain",
      valuePlaceholder: companyDomain,
      targetLabel: "Mailbox",
      targetPlaceholder: `ada@${companyDomain}`,
      hint: "Sends unmatched addresses on this domain to one mailbox.",
      showTarget: true
    };
  }
  if (kind === "blocked") {
    return {
      valueLabel: "Address, domain, or remote address",
      valuePlaceholder: "spam@example.com",
      targetLabel: "Mailbox",
      targetPlaceholder: "",
      hint: "Blocks mail from this address, domain, or remote address.",
      showTarget: false
    };
  }
  return {
    valueLabel: "Alias address",
    valuePlaceholder: `sales@${companyDomain}`,
    targetLabel: "Mailbox",
    targetPlaceholder: `ada@${companyDomain}`,
    hint: "Forwards this address to one mailbox.",
    showTarget: true
  };
}

function applyAddressKindChrome(companyDomain: string): void {
  const kind = element<HTMLSelectElement>("#address-kind").value;
  const chrome = addressKindChrome(kind, companyDomain);
  const valueLabel = element<HTMLLabelElement>("label[for='address-value']");
  const targetLabel = element<HTMLLabelElement>("label[for='address-target']");
  const valueInput = element<HTMLInputElement>("#address-value");
  const targetInput = element<HTMLInputElement>("#address-target");
  const hint = element<HTMLElement>("#address-kind-hint");
  valueLabel.textContent = chrome.valueLabel;
  valueInput.placeholder = chrome.valuePlaceholder;
  targetLabel.textContent = chrome.targetLabel;
  targetInput.placeholder = chrome.targetPlaceholder;
  hint.textContent = chrome.hint;
  targetLabel.hidden = !chrome.showTarget;
  targetInput.hidden = !chrome.showTarget;
  targetInput.required = chrome.showTarget;
  if (!chrome.showTarget) {
    targetInput.value = "";
  }
}

function routeRows(routes: AddressRoutes): string {
  const aliases = routes.aliases.map((alias) => `<li>${escapeHtml(alias.address)} goes to ${escapeHtml(alias.mailboxAddress)} <button class="quiet-button" type="button" data-remove="alias" data-value="${escapeHtml(alias.address)}">Remove</button></li>`).join("");
  const lists = routes.lists.map((list) => `<li>${escapeHtml(list.address)} goes to ${escapeHtml(list.mailboxAddresses.join(", "))} <button class="quiet-button" type="button" data-remove="list" data-value="${escapeHtml(list.address)}">Remove</button></li>`).join("");
  const domains = routes.domains.map((domain) => `<li>${escapeHtml(domain)} <button class="quiet-button" type="button" data-remove="domain" data-value="${escapeHtml(domain)}">Remove</button></li>`).join("");
  const catchAlls = routes.catchAllMailboxes.map((item) => `<li>Unmatched mail at ${escapeHtml(item.domain)} goes to ${escapeHtml(item.mailboxAddress)} <button class="quiet-button" type="button" data-remove="catch-all" data-value="${escapeHtml(item.domain)}">Remove</button></li>`).join("");
  const blockedItems = [...routes.blockedSenders, ...routes.blockedDomains, ...routes.blockedRemoteAddresses];
  const blocked = blockedItems.map((value) => `<li>${escapeHtml(value)} <button class="quiet-button" type="button" data-remove="blocked" data-value="${escapeHtml(value)}">Remove</button></li>`).join("");
  return `
    ${fold(`Aliases (${routes.aliases.length})`, aliases ? `<ul>${aliases}</ul>` : "<p>No aliases yet.</p>", routes.aliases.length >= 1)}
    ${fold(`Lists (${routes.lists.length})`, lists ? `<ul>${lists}</ul>` : "<p>No lists yet.</p>", routes.lists.length >= 1)}
    ${fold(`Extra domains (${routes.domains.length})`, domains ? `<ul>${domains}</ul>` : "<p>Only the company domain is accepted.</p>", routes.domains.length >= 1)}
    ${fold(`Catch-all (${routes.catchAllMailboxes.length})`, catchAlls ? `<ul>${catchAlls}</ul>` : "<p>Unmatched addresses are rejected.</p>", routes.catchAllMailboxes.length >= 1)}
    ${fold(`Blocked senders (${blockedItems.length})`, blocked ? `<ul>${blocked}</ul>` : "<p>No blocked senders.</p>", blockedItems.length >= 1)}`;
}

async function renderAddresses(notice = ""): Promise<void> {
  const generation = currentRouteGeneration();
  const payload = await requestJson<{ companyDomain: string; routes: AddressRoutes }>(ApiEndpoint.AddressRoutes);
  const chrome = addressKindChrome("alias", payload.companyDomain);
  const saved = notice ? `<div class="notice"><h2>Saved</h2><p>${escapeHtml(notice)}</p></div>` : "";
  replaceMainContent(`
    <header class="page-header"><div><p class="eyebrow">${escapeHtml(payload.companyDomain)}</p><h1>Addresses</h1></div></header>
    ${saved}
    <form id="address-form" class="card detail-card">
      <div id="address-summary" class="error-summary" tabindex="-1" hidden></div>
      <label for="address-kind">Kind</label>
      <select id="address-kind">
        <option value="alias">Alias</option>
        <option value="list">List</option>
        <option value="domain">Extra domain</option>
        <option value="catch-all">Catch-all</option>
        <option value="blocked">Blocked sender</option>
      </select>
      <label for="address-value">${escapeHtml(chrome.valueLabel)}</label>
      <input id="address-value" required placeholder="${escapeHtml(chrome.valuePlaceholder)}">
      <label for="address-target">${escapeHtml(chrome.targetLabel)}</label>
      <input id="address-target" required placeholder="${escapeHtml(chrome.targetPlaceholder)}">
      <p id="address-kind-hint" class="hint">${escapeHtml(chrome.hint)}</p>
      <div class="form-actions"><button class="primary-button" type="submit">${iconLabel("addUser", "Add address")}</button></div>
    </form>
    <div id="address-routes">${routeRows(payload.routes)}</div>`, generation, currentRouteGeneration());
  if (generation !== currentRouteGeneration()) {
    return;
  }
  element<HTMLSelectElement>("#address-kind").addEventListener("change", () => {
    applyAddressKindChrome(payload.companyDomain);
  });
  element<HTMLFormElement>("#address-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveAddress();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      void removeAddress(button.dataset.remove || "", button.dataset.value || "");
    });
  });
}

async function saveAddress(): Promise<void> {
  const form = element<HTMLFormElement>("#address-form");
  const summary = element<HTMLElement>("#address-summary");
  clearFormErrors(form, summary);
  const kind = element<HTMLSelectElement>("#address-kind").value;
  const value = element<HTMLInputElement>("#address-value").value.trim();
  const target = element<HTMLInputElement>("#address-target").value.trim();
  try {
    if (kind === "alias") {
      await requestJson(ApiEndpoint.AddressRouteAliases, { method: "POST", body: JSON.stringify({ address: value, mailboxAddress: target }) });
    } else if (kind === "list") {
      await requestJson(ApiEndpoint.AddressRouteLists, { method: "POST", body: JSON.stringify({ address: value, mailboxAddresses: target }) });
    } else if (kind === "domain") {
      await requestJson(ApiEndpoint.AddressRouteDomains, { method: "POST", body: JSON.stringify({ domain: value }) });
    } else if (kind === "catch-all") {
      await requestJson(ApiEndpoint.AddressRouteCatchAll, { method: "POST", body: JSON.stringify({ domain: value, mailboxAddress: target }) });
    } else {
      await requestJson(ApiEndpoint.AddressRouteBlocked, { method: "POST", body: JSON.stringify({ value }) });
    }
    await renderAddresses("The address was saved.");
  } catch (error) {
    showFormError(form, summary, errorMessage(error), "address-value");
  }
}

async function removeAddress(kind: string, value: string): Promise<void> {
  if (kind === "alias") {
    await requestJson(ApiEndpoint.AddressRouteAliases, { method: "POST", body: JSON.stringify({ remove: true, address: value }) });
  } else if (kind === "list") {
    await requestJson(ApiEndpoint.AddressRouteLists, { method: "POST", body: JSON.stringify({ remove: true, address: value }) });
  } else if (kind === "domain") {
    await requestJson(ApiEndpoint.AddressRouteDomains, { method: "POST", body: JSON.stringify({ remove: true, domain: value }) });
  } else if (kind === "catch-all") {
    await requestJson(ApiEndpoint.AddressRouteCatchAll, { method: "POST", body: JSON.stringify({ remove: true, domain: value }) });
  } else {
    await requestJson(ApiEndpoint.AddressRouteBlocked, { method: "POST", body: JSON.stringify({ remove: true, value }) });
  }
  await renderAddresses("The address was removed.");
}

export const addressDirectoryPage: Page = {
  matches(route, role) {
    return role === "administrator" && route === "addresses";
  },
  async render() {
    await renderAddresses();
  }
};
