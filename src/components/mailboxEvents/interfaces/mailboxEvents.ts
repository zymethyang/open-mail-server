export interface MailboxChange {
  address: string;
  folderStorageName: string;
}

export interface MailboxEvents {
  subscribe(listener: (change: MailboxChange) => void): () => void;
  publish(change: MailboxChange): void;
}
