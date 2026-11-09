import { MailFolderName } from "../enums/mailFolderName.js";
import type { MailFolder } from "../interfaces/mailTypes.js";

export const permanentFolders: MailFolder[] = [
  { storageName: MailFolderName.Inbox, displayName: "INBOX", label: "Inbox", permanent: true, specialUse: "\\Inbox" },
  { storageName: MailFolderName.Sent, displayName: "Sent", label: "Sent", permanent: true, specialUse: "\\Sent" },
  { storageName: MailFolderName.Drafts, displayName: "Drafts", label: "Drafts", permanent: true, specialUse: "\\Drafts" },
  { storageName: MailFolderName.Trash, displayName: "Trash", label: "Trash", permanent: true, specialUse: "\\Trash" },
  { storageName: MailFolderName.Junk, displayName: "Junk", label: "Junk", permanent: true, specialUse: "\\Junk" }
];
