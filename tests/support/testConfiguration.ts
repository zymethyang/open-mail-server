import type { Configuration } from "../../src/components/configuration/index.js";

export function testConfiguration(storageDirectory: string): Configuration {
  return {
    host: "127.0.0.1",
    storageDirectory,
    webPort: 0,
    smtpPort: 0,
    smtpSecurePort: 0,
    smtpSubmissionPort: 0,
    imapPort: 0,
    imapSecurePort: 0,
    pop3Port: 0,
    pop3SecurePort: 0,
    maximumMessageBytes: 25 * 1024 * 1024,
    configuredDomain: "acme.test",
    publicHostname: "",
    secureWeb: false
  };
}
