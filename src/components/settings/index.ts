import path from "node:path";
import {
  defaultBindHost,
  defaultImapPort,
  defaultImapSecurePort,
  defaultPop3Port,
  defaultPop3SecurePort,
  defaultSecureWeb,
  defaultSmtpPort,
  defaultSmtpSecurePort,
  defaultSmtpSubmissionPort,
  defaultWebPort
} from "../configuration/constants/serverDefaults.js";
import { RelaySecurity } from "./enums/relaySecurity.js";
import type { ListenerSettings, ServerSettings, SettingsRepository as SettingsRepositoryContract } from "./interfaces/settings.js";
import { readJson, writeJson } from "../jsonFile/index.js";
import { withLock } from "../jsonFile/index.js";

function defaultListeners(): ListenerSettings {
  return {
    host: defaultBindHost,
    webPort: defaultWebPort,
    smtpPort: defaultSmtpPort,
    smtpSecurePort: defaultSmtpSecurePort,
    smtpSubmissionPort: defaultSmtpSubmissionPort,
    imapPort: defaultImapPort,
    imapSecurePort: defaultImapSecurePort,
    pop3Port: defaultPop3Port,
    pop3SecurePort: defaultPop3SecurePort,
    secureWeb: defaultSecureWeb
  };
}

function emptySettings(): ServerSettings {
  return {
    publicHostname: "",
    relay: {
      enabled: false,
      host: "",
      port: 587,
      username: "",
      password: "",
      security: RelaySecurity.StartTls
    },
    listeners: defaultListeners(),
    listenersSaved: false
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

function fixedListeners(secureWeb: boolean): ListenerSettings {
  return {
    ...defaultListeners(),
    secureWeb
  };
}

function assertSecurity(value: string): RelaySecurity {
  if (value === RelaySecurity.Tls) {
    return RelaySecurity.Tls;
  }
  if (value === RelaySecurity.Plain) {
    return RelaySecurity.Plain;
  }
  if (value === RelaySecurity.StartTls) {
    return RelaySecurity.StartTls;
  }
  throw Object.assign(new Error("Relay security must be STARTTLS, TLS, or plain"), { statusCode: 400 });
}

function createSettingsRepository(storageDirectory: string): SettingsRepositoryContract {
  const filePath = path.join(storageDirectory, "settings.json");

  async function readUnlocked(): Promise<ServerSettings> {
    try {
      const stored = await readJson<Partial<ServerSettings>>(filePath);
      const relay = stored.relay || emptySettings().relay;
      const listenersSaved = stored.listenersSaved === true;
      const secureWeb = listenersSaved && stored.listeners?.secureWeb === true;
      return {
        publicHostname: cleanHostname(stored.publicHostname || ""),
        relay: {
          enabled: Boolean(relay.enabled),
          host: cleanHostname(relay.host || ""),
          port: Number.isInteger(relay.port) ? relay.port : 587,
          username: String(relay.username || ""),
          password: String(relay.password || ""),
          security: relay.security === RelaySecurity.Tls || relay.security === RelaySecurity.Plain ? relay.security : RelaySecurity.StartTls
        },
        listeners: fixedListeners(secureWeb),
        listenersSaved
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptySettings();
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
        secureWeb: settings.listeners.secureWeb
      };
    },

    async update(input) {
      const publicHostname = assertHostname(input.publicHostname, "Public hostname");
      const host = assertHostname(input.relay.host, "Relay host");
      const port = Number(input.relay.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw Object.assign(new Error("Relay port must be from 1 to 65535"), { statusCode: 400 });
      }
      const security = assertSecurity(input.relay.security);
      if (input.relay.enabled && !host) {
        throw Object.assign(new Error("Enter the relay host"), { statusCode: 400 });
      }
      return withLock("settings", async () => {
        const current = await readUnlocked();
        const password = input.relay.password ? input.relay.password : current.relay.password;
        const secureWeb = input.secureWeb === undefined ? current.listeners.secureWeb : input.secureWeb === true;
        const next: ServerSettings = {
          publicHostname,
          relay: {
            enabled: input.relay.enabled,
            host,
            port,
            username: input.relay.username.trim(),
            password,
            security
          },
          listeners: fixedListeners(secureWeb),
          listenersSaved: input.secureWeb === undefined ? current.listenersSaved : true
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

  constructor(storageDirectory: string) {
    this.repository = createSettingsRepository(storageDirectory);
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
