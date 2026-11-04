import type { MailboxChange, MailboxEvents as MailboxEventsContract } from "./interfaces/mailboxEvents.js";

export class MailboxEvents implements MailboxEventsContract {
  private readonly listeners = new Set<(change: MailboxChange) => void>();

  subscribe(listener: (change: MailboxChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(change: MailboxChange): void {
    for (const listener of this.listeners) {
      queueMicrotask(() => listener(change));
    }
  }
}
