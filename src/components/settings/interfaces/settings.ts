import type { RelaySecurity } from "../enums/relaySecurity.js";

export interface MailRelaySettings {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  security: RelaySecurity;
}

export interface ListenerSettings {
  host: string;
  webPort: number;
  smtpPort: number;
  smtpSecurePort: number;
  smtpSubmissionPort: number;
  imapPort: number;
  imapSecurePort: number;
  pop3Port: number;
  pop3SecurePort: number;
  secureWeb: boolean;
}

export interface StorageLimits {
  maximumMessageBytes: number;
  mailboxQuotaBytes: number;
  maximumUnauthenticatedConnections: number;
  maximumUnauthenticatedMessages: number;
}

export interface ServerSettings {
  publicHostname: string;
  relay: MailRelaySettings;
  listeners: ListenerSettings;
  listenersSaved: boolean;
  limits: StorageLimits;
}

export interface PublicServerSettings {
  publicHostname: string;
  relay: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    security: RelaySecurity;
    passwordSaved: boolean;
  };
  secureWeb: boolean;
  limits: StorageLimits;
}

export interface SettingsRepository {
  read(): Promise<ServerSettings>;
  update(input: {
    publicHostname: string;
    relay: {
      enabled: boolean;
      host: string;
      port: number;
      username: string;
      password: string;
      security: RelaySecurity;
    };
    secureWeb?: boolean;
    limits?: Partial<StorageLimits>;
  }): Promise<PublicServerSettings>;
  present(settings: ServerSettings): PublicServerSettings;
}
