import dns from "node:dns/promises";
import { ServerPort } from "../configuration/enums/serverPort.js";
import type { MailExchange, MailExchangeResolver } from "./interfaces/mailExchange.js";

export class DnsMailExchangeResolver implements MailExchangeResolver {
  async resolve(domain: string): Promise<MailExchange[]> {
    try {
      const records = await dns.resolveMx(domain);
      const usable = records
        .filter((record) => record.exchange)
        .sort((left, right) => left.priority - right.priority)
        .map((record) => ({ host: record.exchange.replace(/\.$/, ""), port: 25 }));
      if (usable.length) {
        return usable;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENODATA" && code !== "ENOTFOUND" && code !== "ESERVFAIL") {
        throw error;
      }
    }
    return [{ host: domain, port: ServerPort.Smtp }];
  }
}
