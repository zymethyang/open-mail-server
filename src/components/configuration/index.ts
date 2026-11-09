import path from "node:path";
import type { ListenerSettings } from "../settings/interfaces/settings.js";
import { ServerPort } from "./enums/serverPort.js";
import {
  defaultBindHost,
  defaultMaximumMessageBytes,
  defaultSecureWeb,
  defaultStorageDirectoryName
} from "./constants/serverDefaults.js";
import type { Configuration } from "./interfaces/configuration.js";
import { projectDirectoryFrom } from "./utils/projectDirectory.js";

export type { Configuration };

const projectDirectory = projectDirectoryFrom(import.meta.url);

export function loadConfiguration(): Configuration {
  return {
    host: defaultBindHost,
    storageDirectory: path.join(projectDirectory, defaultStorageDirectoryName),
    webPort: ServerPort.Web,
    smtpPort: ServerPort.Smtp,
    smtpSecurePort: ServerPort.SmtpSecure,
    smtpSubmissionPort: ServerPort.SmtpSubmission,
    imapPort: ServerPort.Imap,
    imapSecurePort: ServerPort.ImapSecure,
    pop3Port: ServerPort.Pop3,
    pop3SecurePort: ServerPort.Pop3Secure,
    maximumMessageBytes: defaultMaximumMessageBytes,
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
