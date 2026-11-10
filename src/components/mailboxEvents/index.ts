import type { MailboxChange, MailboxEvents as MailboxEventsContract } from "./interfaces/mailboxEvents.js";
import type { MailboxNotice } from "./interfaces/mailboxNotice.js";

export class MailboxEvents implements MailboxEventsContract {
  private readonly listeners = new Set<(change: MailboxChange) => void>();
  private readonly channel = new BroadcastChannel("email-server-mailbox");

  constructor() {
    (this.channel as BroadcastChannel & { unref(): void }).unref();
    this.channel.addEventListener("message", (event: MessageEvent<MailboxNotice>) => {
      const notice = event.data;
      if (!notice || notice.kind !== "mailbox" || typeof notice.address !== "string" || typeof notice.folderStorageName !== "string") {
        return;
      }
      this.notify({ address: notice.address, folderStorageName: notice.folderStorageName });
    });
  }

  subscribe(listener: (change: MailboxChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(change: MailboxChange): void {
    this.notify(change);
    this.channel.postMessage({ kind: "mailbox", address: change.address, folderStorageName: change.folderStorageName });
  }

  private notify(change: MailboxChange): void {
    for (const listener of this.listeners) {
      queueMicrotask(() => listener(change));
    }
  }
}
