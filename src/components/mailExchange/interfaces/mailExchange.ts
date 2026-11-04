export interface MailExchange {
  host: string;
  port: number;
}

export interface MailExchangeResolver {
  resolve(domain: string): Promise<MailExchange[]>;
}
