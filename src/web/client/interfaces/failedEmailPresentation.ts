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
