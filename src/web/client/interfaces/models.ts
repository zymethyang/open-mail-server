export interface SessionAccount {
  address: string;
  displayName?: string;
  role: string;
  oneTimePasswordEnabled?: boolean;
}

export interface OrganizationProfile {
  displayName: string;
  domain: string;
}

export interface DnsRecord {
  type: string;
  host: string;
  value: string;
}

export interface MailClientSettings {
  incomingHost: string;
  incomingPort: number;
  incomingSecurity: string;
  outgoingHost: string;
  outgoingPort: number;
  outgoingSecurity: string;
}

export interface HostingInformation {
  domain: string;
  publicHostname: string;
  secureWeb: boolean;
  dns: DnsRecord[];
  zoneFile?: string;
  clients: MailClientSettings;
}

export interface Bootstrap {
  needsSetup?: boolean;
  configuredDomain?: string;
  account: SessionAccount | null;
  organization?: OrganizationProfile;
  hosting?: HostingInformation;
}

export interface ActivityDay {
  date: string;
  incoming?: number;
  outgoing?: number;
  delivered?: number;
  failed?: number;
  sent?: number;
  rejected?: number;
}

export interface ListenerReport {
  name: string;
  port: number;
  security: string;
  purpose: string;
  started: boolean;
  detail: string;
}

export interface PublicPortCheck {
  port: number;
  result: string;
  detail?: string;
}

export interface PublicPortReport {
  address?: string;
  source?: string;
  checks?: PublicPortCheck[];
}

export interface ActivitySummary {
  organization?: { domain: string };
  mailboxCount: number;
  queued: number;
  attention?: number;
  days: ActivityDay[];
  listeners?: ListenerReport[];
  publicPorts?: PublicPortReport;
  hosting?: HostingInformation;
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

export interface ActivityEvent {
  occurredAt: string;
  protocol: string;
  action?: string;
  remoteAddress?: string;
  mailboxAddress?: string;
  senderAddress: string;
  recipientAddresses: string[];
  subject: string;
  byteCount?: number;
  result: string;
  detail: string;
}

export interface MailboxPerson {
  displayName: string;
  address: string;
  role: string;
  disabled: boolean;
}

export interface MailFolder {
  storageName: string;
  label: string;
  unseenCount: number;
  messageCount: number;
}

export interface MessageSummary {
  identifier: string;
  fromName?: string;
  fromAddress?: string;
  subject?: string;
  snippet?: string;
  date: string;
  seen?: boolean;
  attachmentNames?: string[];
}

export interface MessageAttachment {
  fileName: string;
  contentIdentifier?: string;
  contentType?: string;
  index: number;
}

export interface MessageDetail {
  identifier: string;
  subject: string;
  fromName?: string;
  fromAddress: string;
  toAddresses?: string[];
  copyAddresses?: string[];
  date: string;
  text: string;
  html?: string;
  attachments?: MessageAttachment[];
  messageIdentifierHeader?: string;
}

export interface ComposeDraft {
  to: string;
  copy: string;
  blindCopy: string;
  subject: string;
  html: string;
  replyText: string;
  replyTo: string;
}

export interface ComposerAttachment {
  fileName: string;
  contentType: string;
  contentEncoded: string;
  contentIdentifier: string;
  preview?: boolean;
}

export interface RelaySettings {
  enabled: boolean;
  host: string;
  port: number;
  security: string;
  username: string;
  passwordSaved: boolean;
}

export interface ServerSettings {
  publicHostname: string;
  secureWeb: boolean;
  relay: RelaySettings;
}

export interface CertificateDescription {
  subject: string;
  issuer: string;
  names?: string[];
  validFrom: string;
  validUntil: string;
  selfSigned: boolean;
  intermediateCount?: number;
}
