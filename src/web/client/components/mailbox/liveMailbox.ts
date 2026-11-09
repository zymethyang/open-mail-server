import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { applicationState } from "../../state/applicationState.js";
import { refreshOpenMailbox } from "./index.js";

let mailboxEventSource: EventSource | null = null;
let watchedMailboxAddress = "";
let mailboxRefreshTimer = 0;

export function watchMailbox(address: string): void {
  if (mailboxEventSource && watchedMailboxAddress === address) {
    return;
  }
  stopWatchingMailbox();
  watchedMailboxAddress = address;
  const source = new EventSource(ApiEndpoint.MailboxEvents);
  mailboxEventSource = source;
  source.onopen = () => {
    document.documentElement.dataset.mailboxStream = "open";
  };
  source.onmessage = () => {
    window.clearTimeout(mailboxRefreshTimer);
    mailboxRefreshTimer = window.setTimeout(() => {
      void refreshOpenMailbox().catch(() => undefined);
    }, 150);
  };
}

export function stopWatchingMailbox(): void {
  window.clearTimeout(mailboxRefreshTimer);
  mailboxEventSource?.close();
  mailboxEventSource = null;
  watchedMailboxAddress = "";
  delete document.documentElement.dataset.mailboxStream;
}

export function watchSignedInMailbox(): void {
  const address = applicationState.bootstrap?.account?.address || "";
  if (!address) {
    stopWatchingMailbox();
    return;
  }
  watchMailbox(address);
}
