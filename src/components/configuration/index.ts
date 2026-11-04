import path from "node:path";
import type { ListenerSettings } from "../settings/interfaces/settings.js";
import {
  defaultBindHost,
  defaultImapPort,
  defaultImapSecurePort,
  defaultMaximumMessageBytes,
  defaultPop3Port,
  defaultPop3SecurePort,
  defaultSecureWeb,
  defaultSmtpPort,
  defaultSmtpSecurePort,
  defaultSmtpSubmissionPort,
  defaultStorageDirectoryName,
  defaultWebPort,
  productName
} from "./constants/serverDefaults.js";
import type { Configuration } from "./interfaces/configuration.js";
import { projectDirectoryFrom } from "./utils/projectDirectory.js";

export type { Configuration };

const projectDirectory = projectDirectoryFrom(import.meta.url);

export function loadConfiguration(): Configuration {
  return {
    host: defaultBindHost,
    storageDirectory: path.join(projectDirectory, defaultStorageDirectoryName),
    webPort: defaultWebPort,
    smtpPort: defaultSmtpPort,
    smtpSecurePort: defaultSmtpSecurePort,
    smtpSubmissionPort: defaultSmtpSubmissionPort,
    imapPort: defaultImapPort,
    imapSecurePort: defaultImapSecurePort,
    pop3Port: defaultPop3Port,
    pop3SecurePort: defaultPop3SecurePort,
    maximumMessageBytes: defaultMaximumMessageBytes,
    productName,
    configuredDomain: "",
    publicHostname: "",
    secureWeb: defaultSecureWeb
  };
}

export function configurationWithListeners(configuration: Configuration, listeners: ListenerSettings): Configuration {
  return {
    ...configuration,
    secureWeb: listeners.secureWeb
  };
}
