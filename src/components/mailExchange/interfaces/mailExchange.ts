export interface MailExchange {
  host: string;
  port: number;
  trustedCertificate?: string;
}

export interface MailExchangeResolver {
  resolve(domain: string): Promise<MailExchange[]>;
}
