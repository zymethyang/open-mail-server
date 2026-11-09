import { ApiEndpoint, folderMessagesPath } from "../../enums/apiEndpoint.js";
import { MailFolderName } from "../../enums/mailFolderName.js";
import { requestJson } from "../../http/jsonClient.js";
import type { MailFolder, MessageSummary } from "../../interfaces/models.js";
import type { Page } from "../../interfaces/page.js";
import { applicationState } from "../../state/applicationState.js";
import { element } from "../../utils/element.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { buttonIcon, iconLabel, type ButtonIconName } from "../../utils/buttonIcon.js";
import { replaceMainContent } from "../../utils/formFeedback.js";
import { currentRouteGeneration } from "../../state/routeGeneration.js";
import { mailboxActions } from "./actions.js";
import { openComposer, renderComposer } from "./composer.js";
import { folderLabel, messageButton } from "./messageList.js";
import { bindMessages, openMessage } from "./messagePane.js";

function folderIconName(storageName: string): ButtonIconName {
  if (storageName === MailFolderName.Sent) {
    return MailFolderName.Sent;
  }
  if (storageName === MailFolderName.Drafts) {
    return MailFolderName.Drafts;
  }
  if (storageName === MailFolderName.Trash) {
    return MailFolderName.Trash;
  }
  if (storageName === MailFolderName.Junk) {
    return MailFolderName.Junk;
  }
  return MailFolderName.Inbox;
}

function emptyReadingPane(): string {
  return `<button id="back-button" class="quiet-button back-button" type="button">${iconLabel("back", "Back to list")}</button><div class="reading-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/></svg><h2>Select a message</h2><p>Choose a conversation to read it here.</p></div>`;
}

function folderButtons(folders: MailFolder[]): string {
  return folders
    .map((folder) => {
      const unseen = folder.unseenCount > 0 ? `<span class="folder-count">${folder.unseenCount}</span>` : "";
      const current = folder.storageName === applicationState.folderName ? ' aria-current="page"' : "";
      return `<button class="folder-link" type="button" data-folder="${escapeHtml(folder.storageName)}"${current}><span class="folder-label">${buttonIcon(folderIconName(folder.storageName))}<span>${escapeHtml(folder.label)}</span></span>${unseen}</button>`;
    })
    .join("");
}

function messageResults(messages: MessageSummary[], folders: MailFolder[], searching: boolean): string {
  if (messages.length) {
    return messages.map((message) => messageButton(message)).join("");
  }
  if (searching) {
    return `<div class="empty"><h2>No matches</h2><p>Try a sender, subject, or word from the message.</p></div>`;
  }
  return `<div class="empty"><h2>No messages</h2><p>Nothing in ${escapeHtml(folderLabel(folders))}.</p></div>`;
}

function bindFolderButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("#mailbox-layout [data-folder]").forEach((button) => {
    button.addEventListener("click", () => {
      applicationState.folderName = button.dataset.folder || MailFolderName.Inbox;
      applicationState.messageIdentifier = "";
      void renderMailbox();
    });
  });
}

function bindBackButton(): void {
  element("#back-button").addEventListener("click", () => {
    element("#mailbox-layout").classList.remove("show-reading");
  });
}

let mailboxRequest = 0;

export async function renderMailbox(): Promise<void> {
  const generation = currentRouteGeneration();
  const request = ++mailboxRequest;
  const folderPayload = await requestJson<{ folders: MailFolder[] }>(ApiEndpoint.Folders);
  if (request !== mailboxRequest) {
    return;
  }
  const messagePayload = await requestJson<{ messages: MessageSummary[] }>(
    folderMessagesPath(applicationState.folderName)
  );
  if (request !== mailboxRequest || generation !== currentRouteGeneration()) {
    return;
  }
  const folders = folderButtons(folderPayload.folders);
  const messages = messageResults(messagePayload.messages, folderPayload.folders, false);
  replaceMainContent(`
    <div class="mailbox" id="mailbox-layout">
      <nav class="folder-rail" aria-label="Folders">
        <button id="compose-button" class="compose-launch" type="button">${iconLabel("newMessage", "Compose")}</button>
        ${folders}
      </nav>
      <div class="mail-surface">
        <div class="message-column">
          <div class="message-toolbar"><label class="visually-hidden" for="message-search">Search mail</label><input id="message-search" type="search" placeholder="Search mail"></div>
          <div id="message-results" class="message-results">${messages}</div>
        </div>
        <article class="reading" id="reading-pane">${emptyReadingPane()}</article>
      </div>
    </div>`, generation, currentRouteGeneration());
  if (request !== mailboxRequest || generation !== currentRouteGeneration()) {
    return;
  }
  element("#compose-button").addEventListener("click", () => openComposer());
  bindFolderButtons();
  element<HTMLInputElement>("#message-search").addEventListener("input", async (event) => {
    const target = event.target;
    const query = target instanceof HTMLInputElement ? target.value : "";
    const payload = await requestJson<{ messages: MessageSummary[] }>(
      folderMessagesPath(applicationState.folderName, query)
    );
    element("#message-results").innerHTML = messageResults(payload.messages, folderPayload.folders, Boolean(query.trim()));
    bindMessages();
  });
  bindBackButton();
  bindMessages();
  if (applicationState.compose && !document.querySelector("#compose-window")) {
    renderComposer();
  }
  if (applicationState.messageIdentifier) {
    try {
      await openMessage(applicationState.messageIdentifier);
    } catch {
      applicationState.messageIdentifier = "";
    }
  }
}

let mailboxRefreshRequest = 0;

export async function refreshOpenMailbox(): Promise<void> {
  const layout = document.querySelector("#mailbox-layout");
  if (!layout || !location.hash.startsWith("#mailbox")) {
    return;
  }
  const request = ++mailboxRefreshRequest;
  const folderName = applicationState.folderName;
  const search = document.querySelector<HTMLInputElement>("#message-search");
  const query = search?.value || "";
  const folderPayload = await requestJson<{ folders: MailFolder[] }>(ApiEndpoint.Folders);
  if (request !== mailboxRefreshRequest || !layout.isConnected || applicationState.folderName !== folderName) {
    return;
  }
  const messagePayload = await requestJson<{ messages: MessageSummary[] }>(
    folderMessagesPath(folderName, query)
  );
  if (request !== mailboxRefreshRequest || !layout.isConnected || applicationState.folderName !== folderName) {
    return;
  }
  document.querySelectorAll("#mailbox-layout .folder-link").forEach((button) => button.remove());
  element("#mailbox-layout .folder-rail").insertAdjacentHTML("beforeend", folderButtons(folderPayload.folders));
  bindFolderButtons();
  const results = element("#message-results");
  const scroll = results.scrollTop;
  results.innerHTML = messageResults(messagePayload.messages, folderPayload.folders, Boolean(query.trim()));
  results.scrollTop = scroll;
  bindMessages();
  const openIdentifier = applicationState.messageIdentifier;
  if (!openIdentifier) {
    return;
  }
  const stillListed = messagePayload.messages.some((message) => message.identifier === openIdentifier);
  if (query.trim() || stillListed) {
    return;
  }
  applicationState.messageIdentifier = "";
  element("#reading-pane").innerHTML = emptyReadingPane();
  layout.classList.remove("show-reading");
  bindBackButton();
}

mailboxActions.render = renderMailbox;
mailboxActions.openComposer = openComposer;

export const mailboxPage: Page = {
  matches(route) {
    return route.startsWith("mailbox");
  },
  async render() {
    await renderMailbox();
  }
};
