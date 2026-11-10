import type { InboundDisposition } from "../enums/inboundDisposition.js";

export interface MailAuthenticationLookup {
  resolveText(name: string): Promise<string[]>;
  resolveAddresses(name: string): Promise<string[]>;
  resolveMailExchanges(name: string): Promise<string[]>;
}

export interface InboundAuthentication {
  disposition: InboundDisposition;
  detail: string;
}
