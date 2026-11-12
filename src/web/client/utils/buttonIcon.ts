import { MailFolderName } from "../enums/mailFolderName.js";
import { escapeHtml } from "./escapeHtml.js";

export type ButtonIconName =
  | MailFolderName
  | "security"
  | "signOut"
  | "openMailbox"
  | "openAdminPortal"
  | "newMessage"
  | "reply"
  | "forward"
  | "attachment"
  | "savePassword"
  | "disableSignIn"
  | "enableSignIn"
  | "back"
  | "addUser"
  | "edit"
  | "resend"
  | "send";

const iconPaths: Record<ButtonIconName, string> = {
  security: `<path d="M12 3l8 3v6c0 4.5-3.2 7.4-8 9-4.8-1.6-8-4.5-8-9V6z"/>`,
  signOut: `<path d="M10 6V4h10v16H10v-2"/><path d="M4 12h11"/><path d="M11 8l4 4-4 4"/>`,
  openMailbox: `<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>`,
  openAdminPortal: `<path d="M4 11l8-7 8 7"/><path d="M6 10v10h4v-6h4v6h4V10"/>`,
  [MailFolderName.Inbox]: `<path d="M4 5h16v14H4z"/><path d="M4 13h4l2 3h4l2-3h4"/>`,
  [MailFolderName.Sent]: `<path d="M4 12l16-7-6 16-2.5-6.5z"/>`,
  [MailFolderName.Drafts]: `<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9 12h6"/><path d="M9 16h4"/>`,
  [MailFolderName.Trash]: `<path d="M5 7h14"/><path d="M9 7V4h6v3"/><path d="M8 7l1 13h6l1-13"/>`,
  [MailFolderName.Junk]: `<circle cx="12" cy="12" r="8"/><path d="M7.5 7.5l9 9"/>`,
  newMessage: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>`,
  reply: `<path d="M9 14L4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 7 7v2"/>`,
  forward: `<path d="M15 14l5-5-5-5"/><path d="M20 9H11a7 7 0 0 0-7 7v2"/>`,
  attachment: `<path d="M21.4 11.6l-8.5 8.5a5 5 0 0 1-7.1-7.1l8.5-8.5a3.5 3.5 0 0 1 5 5l-8.6 8.5a2 2 0 0 1-2.8-2.8l7.8-7.8"/>`,
  savePassword: `<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H20"/><path d="M17 12v3"/><path d="M14 12v2"/>`,
  disableSignIn: `<path d="M14 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M16 8l5 5"/><path d="M21 8l-5 5"/>`,
  enableSignIn: `<path d="M14 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M16 12l2 2 4-4"/>`,
  back: `<path d="M15 6l-6 6 6 6"/><path d="M9 12h11"/>`,
  addUser: `<path d="M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19 8v6"/><path d="M16 11h6"/>`,
  edit: `<path d="M4 20h4L18.5 9.5l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>`,
  resend: `<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v6h-6"/>`,
  send: `<path d="M4 12l16-7-6 16-2.5-6.5z"/>`
};

export function buttonIcon(name: ButtonIconName): string {
  return `<svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]}</svg>`;
}

export function iconLabel(name: ButtonIconName, label: string): string {
  return `${buttonIcon(name)}<span>${escapeHtml(label)}</span>`;
}
