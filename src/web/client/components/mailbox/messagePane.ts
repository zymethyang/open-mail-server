import { folderAttachmentPath, folderMessagePath } from "../../enums/apiEndpoint.js";
import { MailFolderName } from "../../enums/mailFolderName.js";
import { requestJson } from "../../http/jsonClient.js";
import type { MessageDetail } from "../../interfaces/models.js";
import { applicationState } from "../../state/applicationState.js";
import { element } from "../../utils/element.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { iconLabel } from "../../utils/buttonIcon.js";
import { bindMessageFrame, presentName, previewDocument } from "../../utils/presentation.js";
import { mailboxActions } from "./actions.js";

function imageMediaType(contentType: string, fileName: string): string {
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  if (mediaType === "image/jpg" || mediaType === "image/pjpeg") {
    return "image/jpeg";
  }
  if (mediaType === "image/x-png") {
    return "image/png";
  }
  if (mediaType === "image/jpeg" || mediaType === "image/png" || mediaType === "image/gif" || mediaType === "image/webp") {
    return mediaType;
  }
  const extension = fileName.toLowerCase().split(".").pop() || "";
  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }
  if (extension === "png") {
    return "image/png";
  }
  if (extension === "gif") {
    return "image/gif";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  return "";
}

function contentReferences(identifier: string, fileName: string): string[] {
  const references = new Set<string>();
  const trimmed = identifier.trim();
  if (trimmed) {
    references.add(trimmed);
    const nameBeforeHost = trimmed.split("@")[0];
    if (nameBeforeHost) {
      references.add(nameBeforeHost);
    }
  }
  if (fileName) {
    references.add(fileName);
  }
  return [...references].sort((left, right) => right.length - left.length);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function htmlReferencesAttachment(html: string, identifier: string, fileName: string): boolean {
  const lowerHtml = html.toLowerCase();
  return contentReferences(identifier, fileName).some((reference) => lowerHtml.includes(`cid:${reference.toLowerCase()}`));
}

function imageDataUrl(bytes: Uint8Array, mediaType: string): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mediaType });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("The image could not be read")));
    reader.readAsDataURL(blob);
  });
}

async function inlineMessageImages(message: MessageDetail): Promise<{ html: string; shownInline: Set<number> }> {
  let html = message.html || "";
  const shownInline = new Set<number>();
  for (const attachment of message.attachments || []) {
    const mediaType = imageMediaType(attachment.contentType || "", attachment.fileName);
    if (!html || !mediaType) {
      continue;
    }
    const references = contentReferences(attachment.contentIdentifier || "", attachment.fileName).filter((reference) =>
      html.toLowerCase().includes(`cid:${reference.toLowerCase()}`)
    );
    if (!references.length) {
      continue;
    }
    try {
      const response = await fetch(
        folderAttachmentPath(applicationState.folderName, message.identifier, attachment.index),
        { credentials: "same-origin" }
      );
      if (!response.ok) {
        continue;
      }
      const dataUrl = await imageDataUrl(new Uint8Array(await response.arrayBuffer()), mediaType);
      if (!dataUrl.startsWith("data:image/")) {
        continue;
      }
      for (const reference of references) {
        html = html.replace(new RegExp(`cid:${escapeRegularExpression(reference)}`, "gi"), dataUrl);
      }
      shownInline.add(attachment.index);
    } catch {
      continue;
    }
  }
  html = html.replace(/<img\b[^>]*\ssrc=(["'])cid:[^"']*\1[^>]*>/gi, "");
  return { html, shownInline };
}

export function bindMessages(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-message]").forEach((button) => {
    button.addEventListener("click", () => {
      void openMessage(button.dataset.message || "");
    });
  });
}

export async function openMessage(identifier: string): Promise<void> {
  applicationState.messageIdentifier = identifier;
  const payload = await requestJson<{ message: MessageDetail }>(
    folderMessagePath(applicationState.folderName, identifier)
  );
  const message = payload.message;
  const prepared = await inlineMessageImages(message);
  const html = prepared.html;
  const attachments = (message.attachments || [])
    .filter((attachment) => {
      if (imageMediaType(attachment.contentType || "", attachment.fileName)) {
        return true;
      }
      return !htmlReferencesAttachment(message.html || "", attachment.contentIdentifier || "", attachment.fileName);
    })
    .map((attachment) => {
      const location = folderAttachmentPath(applicationState.folderName, identifier, attachment.index);
      if (imageMediaType(attachment.contentType || "", attachment.fileName)) {
        return `<li><button class="image-open" type="button" data-image="${escapeHtml(location)}" data-image-name="${escapeHtml(attachment.fileName)}">${escapeHtml(attachment.fileName)}</button></li>`;
      }
      return `<li><a href="${location}">${escapeHtml(attachment.fileName)}</a></li>`;
    })
    .join("");
  const senderName = presentName(message.fromName) || message.fromAddress;
  const initial = escapeHtml((senderName.trim()[0] || "?").toUpperCase());
  const body = html
    ? `<iframe class="message-frame" sandbox="allow-same-origin" title="Message" srcdoc="${escapeHtml(previewDocument(html))}"></iframe>`
    : `<div class="message-text">${escapeHtml(message.text).replace(/\n/g, "<br>")}</div>`;
  element("#reading-pane").innerHTML = `
    <button id="back-button" class="quiet-button back-button" type="button">${iconLabel("back", "Back to list")}</button>
    <header class="message-heading">
      <h2>${escapeHtml(message.subject)}</h2>
      <div class="message-person">
        <span class="sender-badge" aria-hidden="true">${initial}</span>
        <div>
          <p class="message-from"><strong>${escapeHtml(senderName)}</strong> <span>&lt;${escapeHtml(message.fromAddress)}&gt;</span></p>
          <p class="muted">${escapeHtml(new Date(message.date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</p>
        </div>
      </div>
      <div class="reading-actions">
        <button id="reply-button" class="message-action" type="button">${iconLabel("reply", "Reply")}</button>
        <button id="forward-button" class="message-action" type="button">${iconLabel("forward", "Forward")}</button>
        <button id="delete-button" class="message-action message-action-delete" type="button">${iconLabel(MailFolderName.Trash, "Delete")}</button>
      </div>
    </header>
    ${attachments ? `<ul class="attachment-list">${attachments}</ul>` : ""}
    <dialog id="image-viewer" class="modal image-viewer">
      <img id="image-viewer-picture" alt="">
      <p id="image-viewer-name"></p>
      <form method="dialog"><button class="quiet-button" type="submit">Close</button></form>
    </dialog>
    ${body}`;
  document.querySelectorAll<HTMLButtonElement>("#reading-pane .image-open").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = element<HTMLDialogElement>("#image-viewer");
      const picture = element<HTMLImageElement>("#image-viewer-picture");
      const name = element<HTMLElement>("#image-viewer-name");
      picture.src = button.dataset.image || "";
      picture.alt = button.dataset.imageName || "Attachment";
      name.textContent = button.dataset.imageName || "";
      dialog.showModal();
    });
  });
  const frame = document.querySelector<HTMLIFrameElement>("#reading-pane .message-frame");
  if (frame) {
    bindMessageFrame(frame);
  }
  document.querySelectorAll<HTMLButtonElement>("[data-message]").forEach((button) => {
    if (button.dataset.message === identifier) {
      button.setAttribute("aria-current", "true");
      button.classList.remove("unread");
    } else {
      button.removeAttribute("aria-current");
    }
  });
  element("#mailbox-layout").classList.add("show-reading");
  element("#back-button").addEventListener("click", () => {
    element("#mailbox-layout").classList.remove("show-reading");
  });
  element("#delete-button").addEventListener("click", async () => {
    await requestJson(folderMessagePath(applicationState.folderName, identifier), { method: "DELETE" });
    applicationState.messageIdentifier = "";
    await mailboxActions.render();
  });
  element("#reply-button").addEventListener("click", () => {
    const sender = presentName(message.fromName) || message.fromAddress;
    mailboxActions.openComposer({
      to: message.fromAddress,
      copy: "",
      blindCopy: "",
      subject: subjectWithPrefix(message.subject, "Re:"),
      html: "",
      replyText: `\n\nOn ${new Date(message.date).toLocaleString()}, ${sender} wrote:\n${message.text}`,
      replyTo: message.messageIdentifierHeader || ""
    });
  });
  element("#forward-button").addEventListener("click", () => {
    const sender = presentName(message.fromName) || message.fromAddress;
    const recipients = [...(message.toAddresses || []), ...(message.copyAddresses || [])].join(", ");
    const recipientLine = recipients ? `To: ${recipients}\n` : "";
    mailboxActions.openComposer({
      to: "",
      copy: "",
      blindCopy: "",
      subject: subjectWithPrefix(message.subject, "Fwd:"),
      html: "",
      replyText: `\n\n---------- Forwarded message ----------\nFrom: ${sender} <${message.fromAddress}>\nDate: ${new Date(message.date).toLocaleString()}\nSubject: ${message.subject}\n${recipientLine}\n${message.text}`,
      replyTo: ""
    });
  });
}

function subjectWithPrefix(subject: string, prefix: string): string {
  const trimmed = subject.trim();
  if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
    return trimmed;
  }
  return `${prefix} ${trimmed}`.trim();
}
