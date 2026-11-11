export interface MailFolder {
  storageName: string;
  displayName: string;
  label: string;
  permanent: boolean;
  specialUse: string;
}

export interface AttachmentRecord {
  fileName: string;
  contentType: string;
  size: number;
  contentEncoded: string;
  contentIdentifier: string;
}

export interface ParsedMessage {
  fromName: string;
  fromAddress: string;
  toAddresses: string[];
  copyAddresses: string[];
  blindCopyAddresses: string[];
  subject: string;
  text: string;
  html: string;
  date: string;
  messageIdentifierHeader: string;
  inReplyTo: string;
  attachments: AttachmentRecord[];
}

export interface MessageDraft {
  fromName: string;
  fromAddress: string;
  toAddresses: string[];
  copyAddresses: string[];
  subject: string;
  text: string;
  html: string;
  date: string;
  messageIdentifierHeader: string;
  inReplyTo: string;
  seen: boolean;
  answered: boolean;
  flagged: boolean;
  deleted: boolean;
  draft: boolean;
  keywords?: string[];
  rawEncoded: string;
  rawSize: number;
  attachments: AttachmentRecord[];
  snippet?: string;
}

export interface MessageSummary {
  identifier: string;
  uniqueIdentifier: number;
  folderName: string;
  fromName: string;
  fromAddress: string;
  toAddresses: string[];
  copyAddresses: string[];
  subject: string;
  date: string;
  messageIdentifierHeader: string;
  inReplyTo: string;
  seen: boolean;
  answered: boolean;
  flagged: boolean;
  deleted: boolean;
  draft: boolean;
  keywords: string[];
  rawSize: number;
  snippet: string;
}

export interface MessageRecord extends MessageDraft {
  identifier: string;
  uniqueIdentifier: number;
  folderName: string;
}

export interface MailboxState {
  validity: number;
  nextUniqueIdentifier: number;
  folders: MailFolder[];
  subscriptions: string[];
}
