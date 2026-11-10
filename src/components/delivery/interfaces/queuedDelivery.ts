export interface QueuedDelivery {
  identifier: string;
  serverDomain: string;
  senderAddress: string;
  authenticatedAddress: string;
  recipientAddresses: string[];
  rawEncoded: string;
  attempts: number;
  nextAttemptAt: string;
  lastError: string;
}
