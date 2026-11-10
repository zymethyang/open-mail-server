import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { MailFolderName } from "../../enums/mailFolderName.js";
import { requestJson } from "../../http/jsonClient.js";
import type { ComposeDraft, ComposerAttachment } from "../../interfaces/models.js";
import { applicationState } from "../../state/applicationState.js";
import { element, optionalElement } from "../../utils/element.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { errorMessage } from "../../utils/errorMessage.js";
import { clearFormErrors } from "../../utils/formFeedback.js";
import { buttonIcon } from "../../utils/buttonIcon.js";
import { mailboxActions } from "./actions.js";

function keepComposerSelection(event: Event): void {
  event.preventDefault();
  rememberComposerSelection();
}

export function bindComposerSelection(): void {
  document.addEventListener("selectionchange", () => {
    const editor = optionalElement<HTMLElement>("#compose-editor");
    const selection = window.getSelection();
    if (!editor || editor.hidden || !selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      return;
    }
    if (range.collapsed && applicationState.composerRange && !applicationState.composerRange.collapsed) {
      return;
    }
    applicationState.composerRange = range.cloneRange();
    markFormatButtons();
  });
}

function rememberComposerSelection(): void {
  const editor = optionalElement<HTMLElement>("#compose-editor");
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer) || range.collapsed) {
    return;
  }
  applicationState.composerRange = range.cloneRange();
}

function restoreComposerSelection(): void {
  const editor = optionalElement<HTMLElement>("#compose-editor");
  if (!editor) {
    return;
  }
  editor.focus();
  if (!applicationState.composerRange) {
    return;
  }
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  selection.removeAllRanges();
  selection.addRange(applicationState.composerRange);
}

function wrapComposerSelection(tagName: string, attributes: Record<string, string> = {}): boolean {
  restoreComposerSelection();
  const editor = optionalElement<HTMLElement>("#compose-editor");
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    return false;
  }
  const wrapper = document.createElement(tagName);
  Object.entries(attributes).forEach(([key, value]) => wrapper.setAttribute(key, value));
  wrapper.appendChild(range.extractContents());
  range.insertNode(wrapper);
  const next = document.createRange();
  next.selectNodeContents(wrapper);
  selection.removeAllRanges();
  selection.addRange(next);
  applicationState.composerRange = next.cloneRange();
  return true;
}

function linkAddress(value: string): string {
  const trimmed = value.trim();
  if (/^https:\/\/\S+$/i.test(trimmed) || /^http:\/\/\S+$/i.test(trimmed) || /^mailto:\S+$/i.test(trimmed)) {
    return trimmed;
  }
  return "";
}

function insertComposerImage(source: string, name: string): void {
  const editor = optionalElement<HTMLElement>("#compose-editor");
  if (!editor) {
    return;
  }
  const image = document.createElement("img");
  image.src = source;
  image.alt = name;
  const block = document.createElement("div");
  block.appendChild(image);
  const range = applicationState.composerRange;
  let node: Node | null = range ? range.startContainer : null;
  if (node && node.nodeType !== Node.ELEMENT_NODE) {
    node = node.parentElement;
  }
  const elementNode = node instanceof Element ? node : null;
  const link = elementNode && editor.contains(elementNode) ? elementNode.closest("a") : null;
  let blockParent: Element | null = link || elementNode;
  while (blockParent && blockParent.parentElement && blockParent.parentElement !== editor) {
    blockParent = blockParent.parentElement;
  }
  if (blockParent && blockParent.parentElement === editor) {
    editor.insertBefore(block, blockParent.nextSibling);
    return;
  }
  editor.appendChild(block);
}

function renderComposerAttachments(): void {
  const list = optionalElement<HTMLElement>("#compose-attachments");
  if (!list) {
    return;
  }
  list.innerHTML = applicationState.composeAttachments
    .map((attachment, index) => `<li>${escapeHtml(attachment.fileName)} <button class="quiet-button" type="button" data-remove-attachment="${index}">Remove</button></li>`)
    .join("");
  list.querySelectorAll<HTMLButtonElement>("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      applicationState.composeAttachments.splice(Number(button.dataset.removeAttachment), 1);
      renderComposerAttachments();
    });
  });
}

function readFileRecord(file: File, inline: boolean): Promise<ComposerAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const encoded = result.includes(",") ? result.split(",")[1] : "";
      const identifier = inline ? `image-${Date.now()}-${applicationState.composeAttachments.length}@local` : "";
      const record: ComposerAttachment = {
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        contentEncoded: encoded,
        contentIdentifier: identifier
      };
      if (inline) {
        insertComposerImage(result, file.name);
      }
      resolve(record);
    };
    reader.readAsDataURL(file);
  });
}

async function addComposerFiles(files: FileList | null, inline: boolean): Promise<void> {
  for (const file of files || []) {
    const record = await readFileRecord(file, inline);
    if (!inline) {
      applicationState.composeAttachments.push(record);
    } else {
      record.preview = true;
    }
  }
  const input = optionalElement<HTMLInputElement>(inline ? "#compose-image" : "#compose-files");
  if (input) {
    input.value = "";
  }
  renderComposerAttachments();
}

function prepareComposerHtml(html: string): { html: string; attachments: ComposerAttachment[] } {
  const attachments: ComposerAttachment[] = [];
  let index = 0;
  const prepared = String(html || "").replace(/<img\b[^>]*\bsrc=(["'])(data:[^"']+)\1[^>]*>/gi, (tag, quote, source) => {
    const identifier = `image-${index}-${Date.now()}@local`;
    const contentType = source.slice(5, source.indexOf(";")) || "image/png";
    const extension = contentType.includes("jpeg") ? "jpg" : contentType.includes("gif") ? "gif" : contentType.includes("webp") ? "webp" : "png";
    attachments.push({
      fileName: `image-${index + 1}.${extension}`,
      contentType,
      contentEncoded: source.split(",")[1] || "",
      contentIdentifier: identifier
    });
    index += 1;
    return tag.replace(`${quote}${source}${quote}`, `${quote}cid:${identifier}${quote}`);
  });
  return { html: prepared, attachments };
}

const recipientAddressPattern = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)*[a-z0-9-]+$/i;

function normalizeRecipient(value: string): string {
  const text = value.trim();
  const wrapped = text.match(/<([^<>]+)>/);
  return (wrapped ? wrapped[1] : text).trim().toLowerCase();
}

function recipientPieces(text: string): string[] {
  const pattern = /(?:[^<>,;\s]+(?:\s+[^<>,;\s]+)*\s*)?<[^<>]+>|[^<>,;\s]+/g;
  return (text.match(pattern) || []).map((token) => normalizeRecipient(token)).filter(Boolean);
}

function validRecipient(address: string): boolean {
  return address.length <= 254 && recipientAddressPattern.test(address);
}

function listedRecipients(field: HTMLElement): string[] {
  return [...field.querySelectorAll<HTMLElement>(".address-chip")]
    .map((chip) => chip.dataset.address || "")
    .filter(Boolean);
}

function paintRecipientField(field: HTMLElement, addresses: string[]): void {
  const input = field.querySelector<HTMLInputElement>("input");
  if (!input) {
    return;
  }
  field.querySelectorAll(".address-chip").forEach((chip) => chip.remove());
  for (const address of addresses) {
    const chip = document.createElement("span");
    chip.className = "address-chip";
    chip.dataset.address = address;
    const label = document.createElement("span");
    label.textContent = address;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "address-chip-remove";
    remove.setAttribute("aria-label", `Remove ${address}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      chip.remove();
      input.focus();
    });
    chip.append(label, remove);
    field.insertBefore(chip, input);
  }
}

function showComposeProblem(message: string, fieldId = ""): void {
  const summary = element<HTMLElement>("#compose-summary");
  const form = element<HTMLFormElement>("#compose-panel");
  clearFormErrors(form, summary);
  summary.hidden = false;
  summary.innerHTML = `<h2>There is a problem</h2><p>${escapeHtml(message)}</p>`;
  const field = fieldId ? form.querySelector<HTMLElement>(`#${fieldId}`) : null;
  if (!field) {
    summary.focus();
    return;
  }
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", "compose-summary");
  field.focus();
}

function composeFailureMessage(error: unknown): string {
  const message = errorMessage(error);
  if (message === "Something went wrong" || message === "Request failed") {
    return "The message could not be sent. Check the addresses and try again.";
  }
  return message;
}

function sendFailureKeepsComposerOpen(error: unknown): boolean {
  const message = errorMessage(error);
  return message !== "Failed to fetch" && message !== "Load failed" && message !== "NetworkError when attempting to fetch resource.";
}

function commitRecipientField(field: HTMLElement, reportError: boolean): boolean {
  const input = field.querySelector<HTMLInputElement>("input");
  if (!input) {
    return true;
  }
  const pieces = recipientPieces(input.value);
  if (!pieces.length) {
    return true;
  }
  const invalid = pieces.find((address) => !validRecipient(address)) || "";
  const summary = element<HTMLElement>("#compose-summary");
  const form = element<HTMLFormElement>("#compose-panel");
  if (invalid) {
    if (reportError) {
      showComposeProblem(`${invalid} is not a valid email address.`, input.id);
    }
    return false;
  }
  clearFormErrors(form, summary);
  const addresses = listedRecipients(field);
  for (const address of pieces) {
    if (!addresses.includes(address)) {
      addresses.push(address);
    }
  }
  paintRecipientField(field, addresses);
  input.value = "";
  return true;
}

function committedRecipients(fieldIdentifier: string): string[] | null {
  const field = element<HTMLElement>(fieldIdentifier);
  if (!commitRecipientField(field, true)) {
    return null;
  }
  return listedRecipients(field);
}

function bindRecipientField(fieldIdentifier: string, initial: string): void {
  const field = element<HTMLElement>(fieldIdentifier);
  const input = field.querySelector<HTMLInputElement>("input");
  if (!input) {
    return;
  }
  const addresses: string[] = [];
  for (const address of recipientPieces(initial)) {
    if (validRecipient(address) && !addresses.includes(address)) {
      addresses.push(address);
    }
  }
  paintRecipientField(field, addresses);
  field.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }
    input.focus();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "," || event.key === ";") {
      event.preventDefault();
      commitRecipientField(field, true);
      return;
    }
    if (event.key === " " && input.value.trim()) {
      event.preventDefault();
      commitRecipientField(field, true);
      return;
    }
    if (event.key === "Backspace" && !input.value) {
      const chips = field.querySelectorAll(".address-chip");
      chips.item(chips.length - 1)?.remove();
    }
  });
  input.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text") || "";
    if (!/[;,\s]/.test(text)) {
      return;
    }
    event.preventDefault();
    input.value = `${input.value}${text}`;
    commitRecipientField(field, true);
  });
  input.addEventListener("blur", () => {
    commitRecipientField(field, true);
  });
}

function composeIcon(path: string): string {
  return `<svg class="compose-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

function runFormatCommand(command: string, value?: string): void {
  restoreComposerSelection();
  document.execCommand(command, false, value);
}

function markFormatButtons(): void {
  const commands = [
    ["bold", "format-bold"],
    ["italic", "format-italic"],
    ["underline", "format-underline"]
  ] as const;
  for (const [command, identifier] of commands) {
    const button = optionalElement<HTMLButtonElement>(`#${identifier}`);
    if (!button) {
      return;
    }
    let active = false;
    try {
      active = document.queryCommandState(command);
    } catch {
      active = false;
    }
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

let composeRequestActive = false;

function showSendProgress(active: boolean): void {
  const button = optionalElement<HTMLButtonElement>("#send-button");
  const label = button?.querySelector("span");
  if (!button || !label) {
    return;
  }
  button.disabled = active;
  button.classList.toggle("is-sending", active);
  button.setAttribute("aria-busy", active ? "true" : "false");
  label.textContent = active ? "Sending" : "Send";
}

async function submitCompose(): Promise<void> {
  if (composeRequestActive) {
    return;
  }
  const summary = element<HTMLElement>("#compose-summary");
  const form = element<HTMLFormElement>("#compose-panel");
  clearFormErrors(form, summary);
  const editor = element<HTMLElement>("#compose-editor");
  const toAddresses = committedRecipients("#to-field");
  const copyAddresses = toAddresses ? committedRecipients("#copy-field") : null;
  const blindAddresses = copyAddresses ? committedRecipients("#blind-field") : null;
  if (!toAddresses || !copyAddresses || !blindAddresses) {
    return;
  }
  const prepared = prepareComposerHtml(editor.innerHTML);
  const payload = {
    to: toAddresses.join(", "),
    copy: copyAddresses.join(", "),
    blindCopy: blindAddresses.join(", "),
    subject: element<HTMLInputElement>("#compose-subject").value,
    text: editor.innerText,
    html: prepared.html,
    attachments: [...applicationState.composeAttachments, ...prepared.attachments],
    inReplyTo: editor.dataset.replyTo || ""
  };
  if (!toAddresses.length) {
    showComposeProblem("Enter at least one recipient.", "compose-to");
    return;
  }
  composeRequestActive = true;
  showSendProgress(true);
  try {
    await requestJson(ApiEndpoint.Messages, { method: "POST", body: JSON.stringify(payload) });
  } catch (error) {
    if (sendFailureKeepsComposerOpen(error)) {
      showSendProgress(false);
      showComposeProblem(composeFailureMessage(error));
      return;
    }
  } finally {
    composeRequestActive = false;
  }
  applicationState.folderName = MailFolderName.Sent;
  closeComposer();
  await mailboxActions.render();
}

export function closeComposer(): void {
  applicationState.compose = null;
  applicationState.composeAttachments = [];
  applicationState.composerRange = null;
  document.querySelector("#compose-window")?.remove();
}

export function openComposer(draft?: Partial<ComposeDraft>): void {
  applicationState.composeAttachments = [];
  applicationState.composerRange = null;
  applicationState.compose = {
    to: draft?.to || "",
    copy: draft?.copy || "",
    blindCopy: draft?.blindCopy || "",
    subject: draft?.subject || "",
    html: draft?.html || "",
    replyText: draft?.replyText || "",
    replyTo: draft?.replyTo || ""
  };
  document.querySelector("#compose-window")?.remove();
  renderComposer();
}

export function renderComposer(): void {
  const draft = applicationState.compose;
  if (!draft) {
    return;
  }
  const account = applicationState.bootstrap?.account;
  const fromName = account?.displayName?.trim() || "";
  const fromAddress = account?.address || "";
  const fromLabel = fromName ? `${fromName} <${fromAddress}>` : fromAddress;
  const copyHidden = draft.copy ? "" : " hidden";
  const blindHidden = draft.blindCopy ? "" : " hidden";
  const host = document.createElement("div");
  host.id = "compose-window";
  host.className = "compose-window";
  host.innerHTML = `
    <form id="compose-panel" class="compose-form">
      <header class="compose-titlebar">
        <h2>New message</h2>
        <div class="compose-window-controls">
          <button id="compose-minimize" class="compose-control" type="button" aria-label="Minimize">${composeIcon(`<path d="M5 12h14"/>`)}</button>
          <button id="compose-expand" class="compose-control" type="button" aria-label="Expand">${composeIcon(`<path d="M8 4H4v4"/><path d="M4 4l6 6"/><path d="M16 20h4v-4"/><path d="M20 20l-6-6"/>`)}</button>
          <button id="close-compose" class="compose-control" type="button" aria-label="Close">${composeIcon(`<path d="M6 6l12 12"/><path d="M18 6L6 18"/>`)}</button>
        </div>
      </header>
      <div id="compose-summary" class="error-summary" tabindex="-1" hidden></div>
      <div class="compose-row"><span class="compose-label">From</span><span class="compose-from">${escapeHtml(fromLabel)}</span></div>
      <div class="compose-row recipient-row">
        <label for="compose-to">To</label>
        <div class="recipient-line">
          <div id="to-field" class="recipient-field">
            <input id="compose-to" autocomplete="off" aria-label="To">
          </div>
          <div class="compose-extra">
            <button id="show-copy" class="compose-extra-button" type="button"${draft.copy ? " hidden" : ""}>Cc</button>
            <button id="show-blind-copy" class="compose-extra-button" type="button"${draft.blindCopy ? " hidden" : ""}>Bcc</button>
          </div>
        </div>
      </div>
      <div id="copy-row" class="compose-row recipient-row"${copyHidden}>
        <label for="compose-copy">Cc</label>
        <div id="copy-field" class="recipient-field">
          <input id="compose-copy" autocomplete="off" aria-label="Cc">
        </div>
      </div>
      <div id="blind-row" class="compose-row recipient-row"${blindHidden}>
        <label for="compose-blind-copy">Bcc</label>
        <div id="blind-field" class="recipient-field">
          <input id="compose-blind-copy" autocomplete="off" aria-label="Bcc">
        </div>
      </div>
      <div class="compose-row"><label for="compose-subject">Subject</label><input id="compose-subject" value="${escapeHtml(draft.subject)}"></div>
      <div id="compose-editor" class="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message"></div>
      <input id="compose-files" type="file" multiple hidden>
      <input id="compose-image" type="file" accept="image/*" hidden>
      <ul id="compose-attachments" class="attachment-list"></ul>
      <div id="compose-link-row" class="link-row" hidden>
        <label class="visually-hidden" for="compose-link">Link address</label>
        <input id="compose-link" placeholder="https://example.com">
        <button id="apply-link" class="compose-extra-button" type="button">Apply</button>
      </div>
      <div class="compose-actions">
        <button id="send-button" class="send-button" type="button">${buttonIcon("send")}<span>Send</span></button>
        <div id="compose-format" class="compose-format" role="toolbar" aria-label="Formatting">
          <button id="format-bold" class="format-button" type="button" aria-label="Bold" aria-pressed="false"><strong>B</strong></button>
          <button id="format-italic" class="format-button" type="button" aria-label="Italic" aria-pressed="false">${composeIcon(`<path d="M10 5h7"/><path d="M8 19h7"/><path d="M15 5L10 19"/>`)}</button>
          <button id="format-underline" class="format-button" type="button" aria-label="Underline" aria-pressed="false"><span class="format-underline">U</span></button>
          <label class="format-color"><span class="visually-hidden">Text color</span><span id="format-color-mark" class="format-color-mark">A</span><input id="format-color" type="color" value="#0b57d0"></label>
          <button id="format-list" class="format-button" type="button" aria-label="Bulleted list">${composeIcon(`<path d="M9 7h11"/><path d="M9 12h11"/><path d="M9 17h11"/><circle cx="4.5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="17" r="1" fill="currentColor" stroke="none"/>`)}</button>
          <button id="format-numbered" class="format-button" type="button" aria-label="Numbered list">${composeIcon(`<path d="M10 7h10"/><path d="M10 12h10"/><path d="M10 17h10"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M4 14h2l-2 3h2"/>`)}</button>
          <button id="format-left" class="format-button" type="button" aria-label="Align left">${composeIcon(`<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h16"/>`)}</button>
          <button id="format-center" class="format-button" type="button" aria-label="Align center">${composeIcon(`<path d="M4 6h16"/><path d="M7 12h10"/><path d="M4 18h16"/>`)}</button>
          <button id="format-right" class="format-button" type="button" aria-label="Align right">${composeIcon(`<path d="M4 6h16"/><path d="M10 12h10"/><path d="M4 18h16"/>`)}</button>
        </div>
        <button id="attach-file" class="format-button" type="button" aria-label="Attach files">${composeIcon(`<path d="M21.4 11.6l-8.5 8.5a5 5 0 0 1-7.1-7.1l8.5-8.5a3.5 3.5 0 0 1 5 5l-8.6 8.5a2 2 0 0 1-2.8-2.8l7.8-7.8"/>`)}</button>
        <button id="format-link" class="format-button" type="button" aria-label="Insert link">${composeIcon(`<path d="M10 13a5 5 0 0 0 7.1.1l2.1-2.1a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.1-.1L4.8 13a5 5 0 0 0 7.1 7.1l1.2-1.2"/>`)}</button>
        <button id="insert-image" class="format-button" type="button" aria-label="Insert image">${composeIcon(`<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M20 16l-5-5-8 8"/>`)}</button>
      </div>
    </form>`;
  document.body.appendChild(host);
  const editor = element<HTMLElement>("#compose-editor");
  if (draft.html) {
    editor.innerHTML = draft.html;
  } else if (draft.replyText) {
    editor.innerText = draft.replyText;
  }
  editor.dataset.replyTo = draft.replyTo || "";
  const windowElement = element<HTMLElement>("#compose-window");
  const keepSelection = (target: string) => {
    element(target).addEventListener("mousedown", keepComposerSelection);
  };
  ["#format-bold", "#format-italic", "#format-underline", "#format-link", "#format-list", "#format-numbered", "#format-left", "#format-center", "#format-right", "#insert-image"].forEach(keepSelection);
  editor.addEventListener("mouseup", rememberComposerSelection);
  editor.addEventListener("keyup", rememberComposerSelection);
  element("#compose-panel").addEventListener("submit", (event) => {
    event.preventDefault();
    void submitCompose();
  });
  element("#compose-minimize").addEventListener("click", () => {
    windowElement.classList.toggle("minimized");
    windowElement.classList.remove("expanded");
  });
  element("#compose-expand").addEventListener("click", () => {
    windowElement.classList.toggle("expanded");
    windowElement.classList.remove("minimized");
  });
  element(".compose-titlebar").addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }
    if (windowElement.classList.contains("minimized")) {
      windowElement.classList.remove("minimized");
    }
  });
  element("#close-compose").addEventListener("click", () => closeComposer());
  windowElement.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeComposer();
    }
  });
  element("#show-copy").addEventListener("click", () => {
    element<HTMLElement>("#copy-row").hidden = false;
    element<HTMLElement>("#show-copy").hidden = true;
    element<HTMLInputElement>("#compose-copy").focus();
  });
  element("#show-blind-copy").addEventListener("click", () => {
    element<HTMLElement>("#blind-row").hidden = false;
    element<HTMLElement>("#show-blind-copy").hidden = true;
    element<HTMLInputElement>("#compose-blind-copy").focus();
  });
  element("#format-bold").addEventListener("click", () => runFormatCommand("bold"));
  element("#format-italic").addEventListener("click", () => runFormatCommand("italic"));
  element("#format-underline").addEventListener("click", () => runFormatCommand("underline"));
  element("#format-list").addEventListener("click", () => runFormatCommand("insertUnorderedList"));
  element("#format-numbered").addEventListener("click", () => runFormatCommand("insertOrderedList"));
  element("#format-left").addEventListener("click", () => runFormatCommand("justifyLeft"));
  element("#format-center").addEventListener("click", () => runFormatCommand("justifyCenter"));
  element("#format-right").addEventListener("click", () => runFormatCommand("justifyRight"));
  element<HTMLInputElement>("#format-color").addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      element<HTMLElement>("#format-color-mark").style.setProperty("--format-underline", target.value);
      runFormatCommand("foreColor", target.value);
    }
  });
  element("#format-link").addEventListener("click", () => {
    const row = element<HTMLElement>("#compose-link-row");
    row.hidden = !row.hidden;
    if (!row.hidden) {
      element<HTMLInputElement>("#compose-link").focus();
    }
  });
  element("#apply-link").addEventListener("click", () => {
    const address = linkAddress(element<HTMLInputElement>("#compose-link").value);
    const summary = element<HTMLElement>("#compose-summary");
    const form = element<HTMLFormElement>("#compose-panel");
    if (!address) {
      showComposeProblem("Use a full http, https, or mailto address.", "compose-link");
      return;
    }
    clearFormErrors(form, summary);
    if (!wrapComposerSelection("a", { href: address })) {
      showComposeProblem("Select the words that should become the link.", "compose-link");
      return;
    }
    element<HTMLElement>("#compose-link-row").hidden = true;
    element<HTMLInputElement>("#compose-link").value = "";
  });
  element("#attach-file").addEventListener("click", () => element<HTMLInputElement>("#compose-files").click());
  element("#insert-image").addEventListener("click", () => element<HTMLInputElement>("#compose-image").click());
  element<HTMLInputElement>("#compose-files").addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      void addComposerFiles(target.files, false);
    }
  });
  element<HTMLInputElement>("#compose-image").addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      void addComposerFiles(target.files, true);
    }
  });
  element("#send-button").addEventListener("click", () => {
    void submitCompose();
  });
  renderComposerAttachments();
  bindRecipientField("#to-field", draft.to);
  bindRecipientField("#copy-field", draft.copy);
  bindRecipientField("#blind-field", draft.blindCopy);
  if (draft.to) {
    editor.focus();
  } else {
    element<HTMLInputElement>("#compose-to").focus();
  }
}
