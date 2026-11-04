export interface Configuration {
  host: string;
  storageDirectory: string;
  webPort: number;
  smtpPort: number;
  smtpSecurePort: number;
  smtpSubmissionPort: number;
  imapPort: number;
  imapSecurePort: number;
  pop3Port: number;
  pop3SecurePort: number;
  maximumMessageBytes: number;
  productName: string;
  configuredDomain: string;
  publicHostname: string;
  secureWeb: boolean;
}
