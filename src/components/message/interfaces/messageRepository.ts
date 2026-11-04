import type { MailboxState, MailFolder, MessageDraft, MessageRecord } from "./mailTypes.js";

export interface MessageRepository {
  ensureMailbox(address: string): Promise<void>;
  mailboxState(address: string): Promise<MailboxState>;
  listFolders(address: string): Promise<MailFolder[]>;
  listMessages(address: string, folderName: string): Promise<MessageRecord[]>;
  readMessage(address: string, folderName: string, identifier: string): Promise<MessageRecord>;
  appendMessage(address: string, folderName: string, message: MessageDraft): Promise<MessageRecord>;
  updateMessage(
    address: string,
    folderName: string,
    identifier: string,
    changes: Partial<MessageDraft>
  ): Promise<MessageRecord>;
  removeMessages(address: string, folderName: string, identifiers: string[]): Promise<void>;
  moveMessage(address: string, fromFolderName: string, toFolderName: string, identifier: string): Promise<MessageRecord>;
  createFolder(address: string, displayName: string): Promise<MailFolder>;
  deleteFolder(address: string, displayName: string): Promise<void>;
  renameFolder(address: string, displayName: string, nextDisplayName: string): Promise<MailFolder>;
  setSubscription(address: string, displayName: string, subscribed: boolean): Promise<void>;
}
