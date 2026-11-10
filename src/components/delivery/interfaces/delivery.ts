import type { MailProtocol } from "../../protocol/enums/mailProtocol.js";
import type { ActivityLogger } from "../../activity/interfaces/activityLogger.js";
import type { MailExchangeResolver } from "../../mailExchange/interfaces/mailExchange.js";
import type { MailRelaySettings } from "../../settings/interfaces/settings.js";
import type { AccountRepository } from "../../account/interfaces/accountRepository.js";
import type { MessageRepository } from "../../message/interfaces/messageRepository.js";
import type { MailAuthenticationLookup } from "../../mailAuthentication/interfaces/mailAuthenticationLookup.js";

export interface DeliveryRequest {
  fromAddress: string;
  recipientAddresses: string[];
  rawBuffer: Buffer;
  authenticatedAddress: string;
  remoteAddress: string;
  protocol: MailProtocol;
  acceptExternalImmediately?: boolean;
  bounceMissingMailboxes?: boolean;
}

export interface DeliveryResult {
  localRecipients: string[];
  externalRecipients: string[];
  queuedRecipients: string[];
  warning: string;
}

export interface FailedEmail {
  identifier: string;
  senderAddress: string;
  recipientAddresses: string[];
  subject: string;
  attempts: number;
  nextAttemptAt: string;
  lastError: string;
}

export interface FailedEmailResendResult {
  sent: string[];
  givenUp: string[];
  stillWaiting: FailedEmail[];
}

export interface DeliveryService {
  deliver(request: DeliveryRequest): Promise<DeliveryResult>;
  processQueue(): Promise<void>;
  queuedCount(): Promise<number>;
  listFailedEmail(): Promise<FailedEmail[]>;
  resendFailedEmail(identifiers: string[]): Promise<FailedEmailResendResult>;
}

export interface DeliveryDependencies {
  storageDirectory: string;
  accountRepository: AccountRepository;
  messageRepository: MessageRepository;
  activityLogger: ActivityLogger;
  mailExchangeResolver: MailExchangeResolver;
  serverDomain: () => Promise<string>;
  announceName: () => Promise<string>;
  readRelay: () => Promise<MailRelaySettings>;
  signOutgoingMessage?: (rawMessage: Buffer) => Promise<Buffer>;
  mailAuthenticationLookup?: MailAuthenticationLookup;
}
