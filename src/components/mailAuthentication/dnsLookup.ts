import dns from "node:dns/promises";
import type { MailAuthenticationLookup } from "./interfaces/mailAuthenticationLookup.js";

const lookupTimeoutMilliseconds = 3_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("The name lookup timed out"), { code: "ETIMEOUT" })), lookupTimeoutMilliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function missingName(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOTFOUND" || code === "ENODATA" || code === "ENOENT";
}

export function dnsMailAuthenticationLookup(): MailAuthenticationLookup {
  return {
    async resolveText(name) {
      const records = await withTimeout(dns.resolveTxt(name));
      return records.map((chunks) => chunks.join(""));
    },
    async resolveAddresses(name) {
      const addresses: string[] = [];
      try {
        addresses.push(...(await withTimeout(dns.resolve4(name))));
      } catch (error) {
        if (!missingName(error)) {
          throw error;
        }
      }
      try {
        addresses.push(...(await withTimeout(dns.resolve6(name))));
      } catch (error) {
        if (!missingName(error)) {
          throw error;
        }
      }
      return addresses;
    },
    async resolveMailExchanges(name) {
      const records = await withTimeout(dns.resolveMx(name));
      return records.map((record) => record.exchange.replace(/\.$/, ""));
    }
  };
}

export function emptyMailAuthenticationLookup(): MailAuthenticationLookup {
  return {
    async resolveText() {
      return [];
    },
    async resolveAddresses() {
      return [];
    },
    async resolveMailExchanges() {
      return [];
    }
  };
}

export function lookupIsMissingName(error: unknown): boolean {
  return missingName(error);
}
