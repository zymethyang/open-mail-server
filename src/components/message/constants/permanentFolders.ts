import type { MailFolder } from "../interfaces/mailTypes.js";

export const permanentFolders: MailFolder[] = [
  { storageName: "inbox", displayName: "INBOX", label: "Inbox", permanent: true, specialUse: "\\Inbox" },
  { storageName: "sent", displayName: "Sent", label: "Sent", permanent: true, specialUse: "\\Sent" },
  { storageName: "drafts", displayName: "Drafts", label: "Drafts", permanent: true, specialUse: "\\Drafts" },
  { storageName: "trash", displayName: "Trash", label: "Trash", permanent: true, specialUse: "\\Trash" }
];
