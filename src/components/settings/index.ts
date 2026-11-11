import path from "node:path";
import {
  defaultBindHost,
  defaultMailboxQuotaBytes,
  defaultMaximumMessageBytes,
  defaultMaximumUnauthenticatedConnections,
  defaultMaximumUnauthenticatedMessages,
  defaultSecureWeb,
  maximumConfigurableMessageBytes
} from "../configuration/constants/serverDefaults.js";
import { ServerPort } from "../configuration/enums/serverPort.js";
import { RelaySecurity } from "./enums/relaySecurity.js";
import type { ListenerSettings, ServerSettings, SettingsRepository as SettingsRepositoryContract, StorageLimits } from "./interfaces/settings.js";
import { readJson, writeJson } from "../jsonFile/index.js";
import { withLock } from "../jsonFile/index.js";

function defaultListeners(): ListenerSettings {
  return {
    host: defaultBindHost,
    webPort: ServerPort.Web,
    smtpPort: ServerPort.Smtp,
    smtpSecurePort: ServerPort.SmtpSecure,
    smtpSubmissionPort: ServerPort.SmtpSubmission,
    imapPort: ServerPort.Imap,
    imapSecurePort: ServerPort.ImapSecure,
    pop3Port: ServerPort.Pop3,
    pop3SecurePort: ServerPort.Pop3Secure,
    secureWeb: defaultSecureWeb
  };
}

function defaultLimits(fallbackMaximumMessageBytes = defaultMaximumMessageBytes): StorageLimits {
  const maximumMessageBytes = boundedInteger(fallbackMaximumMessageBytes, defaultMaximumMessageBytes, 1024, maximumConfigurableMessageBytes);
  return {
    maximumMessageBytes,
    mailboxQuotaBytes: Math.max(defaultMailboxQuotaBytes, maximumMessageBytes),
    maximumUnauthenticatedConnections: defaultMaximumUnauthenticatedConnections,
    maximumUnauthenticatedMessages: defaultMaximumUnauthenticatedMessages
  };
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, number));
}

function storedLimits(value: Partial<StorageLimits> | undefined, fallbackMaximumMessageBytes = defaultMaximumMessageBytes): StorageLimits {
  const defaults = defaultLimits(fallbackMaximumMessageBytes);
  return {
    maximumMessageBytes: boundedInteger(value?.maximumMessageBytes, defaults.maximumMessageBytes, 1024, maximumConfigurableMessageBytes),
    mailboxQuotaBytes: Math.max(
      boundedInteger(value?.mailboxQuotaBytes, defaults.mailboxQuotaBytes, 1024, 100 * 1024 * 1024 * 1024),
      boundedInteger(value?.maximumMessageBytes, defaults.maximumMessageBytes, 1024, maximumConfigurableMessageBytes)
    ),
    maximumUnauthenticatedConnections: boundedInteger(value?.maximumUnauthenticatedConnections, defaults.maximumUnauthenticatedConnections, 1, 500),
    maximumUnauthenticatedMessages: boundedInteger(value?.maximumUnauthenticatedMessages, defaults.maximumUnauthenticatedMessages, 1, 1000)
  };
}

function emptySettings(fallbackMaximumMessageBytes = defaultMaximumMessageBytes): ServerSettings {
  return {
    publicHostname: "",
    relay: {
      enabled: false,
      host: "",
      port: ServerPort.SmtpSubmission,
      username: "",
      password: "",
      security: RelaySecurity.StartTls
    },
    listeners: defaultListeners(),
    listenersSaved: false,
    limits: defaultLimits(fallbackMaximumMessageBytes)
  };
}

function cleanHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function assertHostname(value: string, label: string): string {
  if (!value) {
    return "";
  }
  const hostname = cleanHostname(value);
  const domain = /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/;
  const address = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  if ((!domain.test(hostname) && !address.test(hostname)) || hostname.length > 253) {
    throw Object.assign(new Error(`${label} must be a hostname or address`), { statusCode: 400 });
  }
  return hostname;
}

function fixedListeners(): ListenerSettings {
  return defaultListeners();
}

function matchingSecureRelay(port: number, security: string): { port: number; security: RelaySecurity } | null {
  if (port === ServerPort.SmtpSubmission && security === RelaySecurity.StartTls) {
    return { port: ServerPort.SmtpSubmission, security: RelaySecurity.StartTls };
  }
  if (port === ServerPort.SmtpSecure && security === RelaySecurity.Tls) {
    return { port: ServerPort.SmtpSecure, security: RelaySecurity.Tls };
  }
  return null;
}

function requireSecureRelay(port: number, security: string): { port: number; security: RelaySecurity } {
  const relay = matchingSecureRelay(port, security);
  if (!relay) {
    throw Object.assign(new Error(`Use port ${ServerPort.SmtpSubmission} with STARTTLS or port ${ServerPort.SmtpSecure} with TLS`), { statusCode: 400 });
  }
  return relay;
}

function createSettingsRepository(storageDirectory: string, fallbackMaximumMessageBytes = defaultMaximumMessageBytes): SettingsRepositoryContract {
  const filePath = path.join(storageDirectory, "settings.json");

  async function readUnlocked(): Promise<ServerSettings> {
    try {
      const stored = await readJson<Partial<ServerSettings>>(filePath);
      const relay = stored.relay || emptySettings(fallbackMaximumMessageBytes).relay;
      const listenersSaved = stored.listenersSaved === true;
      const secureRelay = matchingSecureRelay(Number(relay.port), String(relay.security || "")) || {
        port: ServerPort.SmtpSubmission,
        security: RelaySecurity.StartTls
      };
      return {
        publicHostname: cleanHostname(stored.publicHostname || ""),
        relay: {
          enabled: Boolean(relay.enabled),
          host: cleanHostname(relay.host || ""),
          port: secureRelay.port,
          username: String(relay.username || ""),
          password: String(relay.password || ""),
          security: secureRelay.security
        },
        listeners: fixedListeners(),
        listenersSaved,
        limits: storedLimits(stored.limits, fallbackMaximumMessageBytes)
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptySettings(fallbackMaximumMessageBytes);
      }
      throw error;
    }
  }

  const repository: SettingsRepositoryContract = {
    async read() {
      return withLock("settings", () => readUnlocked());
    },

    present(settings) {
      return {
        publicHostname: settings.publicHostname,
        relay: {
          enabled: settings.relay.enabled,
          host: settings.relay.host,
          port: settings.relay.port,
          username: settings.relay.username,
          security: settings.relay.security,
          passwordSaved: Boolean(settings.relay.password)
        },
        secureWeb: settings.listeners.secureWeb,
        limits: settings.limits
      };
    },

    async update(input) {
      const publicHostname = assertHostname(input.publicHostname, "Public hostname");
      const host = assertHostname(input.relay.host, "Relay host");
      const relayConnection = requireSecureRelay(Number(input.relay.port), input.relay.security);
      if (input.relay.enabled && !host) {
        throw Object.assign(new Error("Enter the relay host"), { statusCode: 400 });
      }
      return withLock("settings", async () => {
        const current = await readUnlocked();
        const password = input.relay.password ? input.relay.password : current.relay.password;
        const next: ServerSettings = {
          publicHostname,
          relay: {
            enabled: input.relay.enabled,
            host,
            port: relayConnection.port,
            username: input.relay.username.trim(),
            password,
            security: relayConnection.security
          },
          listeners: fixedListeners(),
          listenersSaved: input.secureWeb === undefined ? current.listenersSaved : true,
          limits: storedLimits({ ...current.limits, ...input.limits }, fallbackMaximumMessageBytes)
        };
        await writeJson(filePath, next);
        return repository.present(next);
      });
    }
  };

  return repository;
}

export class SettingsRepository implements SettingsRepositoryContract {
  private readonly repository: SettingsRepositoryContract;

  constructor(storageDirectory: string, fallbackMaximumMessageBytes = defaultMaximumMessageBytes) {
    this.repository = createSettingsRepository(storageDirectory, fallbackMaximumMessageBytes);
  }

  read() {
    return this.repository.read();
  }

  update(input: Parameters<SettingsRepositoryContract["update"]>[0]) {
    return this.repository.update(input);
  }

  present(settings: ServerSettings) {
    return this.repository.present(settings);
  }
}
