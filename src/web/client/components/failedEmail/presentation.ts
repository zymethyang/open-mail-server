export interface FailedEmailSearchFields {
  senderAddress: string;
  recipientAddresses: string[];
  subject: string;
  lastError: string;
}

export interface FailedEmailNoticeCounts {
  sent: unknown[];
  givenUp: unknown[];
  stillWaiting: unknown[];
}

export function visibleFailedEmail<MessageType extends FailedEmailSearchFields>(messages: MessageType[], query: string): MessageType[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return messages;
  }
  return messages.filter((message) => {
    const haystack = `${message.senderAddress} ${message.recipientAddresses.join(" ")} ${message.subject} ${message.lastError}`.toLowerCase();
    return haystack.includes(needle);
  });
}

export function resendButtonLabel(selectedCount: number): string {
  return selectedCount > 0 ? "Resend selected" : "Resend all";
}

export function failedEmailNotice(result: FailedEmailNoticeCounts): string {
  const sentences: string[] = [];
  if (result.sent.length === 1) {
    sentences.push("1 message was sent.");
  } else if (result.sent.length > 1) {
    sentences.push(`${result.sent.length} messages were sent.`);
  }
  if (result.givenUp.length === 1) {
    sentences.push("1 message could not be sent and was returned to the sender.");
  } else if (result.givenUp.length > 1) {
    sentences.push(`${result.givenUp.length} messages could not be sent and were returned to the sender.`);
  }
  if (!result.sent.length && !result.givenUp.length) {
    sentences.push("Nothing was sent. The mail server rejected it again.");
  }
  if (result.stillWaiting.length === 1) {
    sentences.push("1 message is still waiting.");
  } else if (result.stillWaiting.length > 1) {
    sentences.push(`${result.stillWaiting.length} messages are still waiting.`);
  }
  return sentences.join(" ");
}
