import type { MailFolder, MessageSummary } from "../../interfaces/models.js";
import { applicationState } from "../../state/applicationState.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { presentName } from "../../utils/presentation.js";

export function messageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

export function messageButton(message: MessageSummary): string {
  const name = presentName(message.fromName) || message.fromAddress || "Unknown sender";
  const subject = message.subject || "(no subject)";
  const snippet = message.snippet ? `<span class="message-snippet">${escapeHtml(message.snippet)}</span>` : "";
  const files = (message.attachmentNames || []).length
    ? `<svg class="message-attachment" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.6l-8.5 8.5a5 5 0 0 1-7.1-7.1l8.5-8.5a3.5 3.5 0 0 1 5 5l-8.6 8.5a2 2 0 0 1-2.8-2.8l7.8-7.8"/></svg>`
    : "";
  const current = message.identifier === applicationState.messageIdentifier ? ' aria-current="true"' : "";
  return `<button class="message-button${message.seen ? "" : " unread"}" type="button" data-message="${message.identifier}"${current}>
    <span class="message-line"><span class="message-sender">${escapeHtml(name)}</span><time class="message-time">${escapeHtml(messageTime(message.date))}</time></span>
    <span class="message-summary"><span class="message-subject">${escapeHtml(subject)}</span>${snippet}${files}</span>
  </button>`;
}

export function folderLabel(folders: MailFolder[]): string {
  return folders.find((folder) => folder.storageName === applicationState.folderName)?.label || "Inbox";
}
