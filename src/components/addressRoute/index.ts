import { isIP } from "node:net";
import path from "node:path";
import { domainOf, isValidAddress, normalizeAddress } from "../text/index.js";
import { readJson, writeJson, withLock } from "../jsonFile/index.js";
import type { AddressAlias, AddressList, AddressRoutes, CatchAllMailbox } from "./interfaces/addressRoutes.js";

export type { AddressAlias, AddressList, AddressRoutes, CatchAllMailbox };

function emptyRoutes(): AddressRoutes {
  return {
    domains: [],
    aliases: [],
    lists: [],
    catchAllMailboxes: [],
    blockedSenders: [],
    blockedDomains: [],
    blockedRemoteAddresses: []
  };
}

function isDomain(value: string): boolean {
  return value.length > 0 && value.length <= 253 && /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/.test(value);
}

function routeError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function cleanRoutes(stored: Partial<AddressRoutes> | null): AddressRoutes {
  const routes = emptyRoutes();
  for (const domain of stored?.domains || []) {
    const normalized = String(domain || "").trim().toLowerCase();
    if (isDomain(normalized) && !routes.domains.includes(normalized)) {
      routes.domains.push(normalized);
    }
  }
  for (const alias of stored?.aliases || []) {
    const address = normalizeAddress(alias?.address);
    const mailboxAddress = normalizeAddress(alias?.mailboxAddress);
    if (isValidAddress(address) && isValidAddress(mailboxAddress) && !routes.aliases.some((item) => item.address === address)) {
      routes.aliases.push({ address, mailboxAddress });
    }
  }
  for (const list of stored?.lists || []) {
    const address = normalizeAddress(list?.address);
    const mailboxAddresses = [...new Set((list?.mailboxAddresses || []).map((item) => normalizeAddress(item)).filter((item) => isValidAddress(item)))];
    if (isValidAddress(address) && mailboxAddresses.length && !routes.lists.some((item) => item.address === address)) {
      routes.lists.push({ address, mailboxAddresses });
    }
  }
  for (const catchAll of stored?.catchAllMailboxes || []) {
    const domain = String(catchAll?.domain || "").trim().toLowerCase();
    const mailboxAddress = normalizeAddress(catchAll?.mailboxAddress);
    if (isDomain(domain) && isValidAddress(mailboxAddress) && !routes.catchAllMailboxes.some((item) => item.domain === domain)) {
      routes.catchAllMailboxes.push({ domain, mailboxAddress });
    }
  }
  for (const sender of stored?.blockedSenders || []) {
    const address = normalizeAddress(sender);
    if (isValidAddress(address) && !routes.blockedSenders.includes(address)) {
      routes.blockedSenders.push(address);
    }
  }
  for (const domain of stored?.blockedDomains || []) {
    const normalized = String(domain || "").trim().toLowerCase();
    if (isDomain(normalized) && !routes.blockedDomains.includes(normalized)) {
      routes.blockedDomains.push(normalized);
    }
  }
  for (const remoteAddress of stored?.blockedRemoteAddresses || []) {
    const normalized = String(remoteAddress || "").trim().toLowerCase().replace(/^::ffff:/, "");
    if (normalized && !routes.blockedRemoteAddresses.includes(normalized)) {
      routes.blockedRemoteAddresses.push(normalized);
    }
  }
  return routes;
}

export function createAddressRouteRepository(storageDirectory: string) {
  const filePath = path.join(storageDirectory, "address-routes.json");

  async function readUnlocked(): Promise<AddressRoutes> {
    try {
      return cleanRoutes(await readJson<Partial<AddressRoutes>>(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyRoutes();
      }
      throw error;
    }
  }

  async function writeUnlocked(routes: AddressRoutes): Promise<AddressRoutes> {
    await writeJson(filePath, routes);
    return routes;
  }

  function assertAcceptedDomain(domain: string, companyDomain: string, routes: AddressRoutes): void {
    if (domain !== companyDomain && !routes.domains.includes(domain)) {
      throw routeError(`Add ${domain} before using it in an address`);
    }
  }

  function assertAddressAvailable(address: string, routes: AddressRoutes): void {
    if (routes.aliases.some((item) => item.address === address) || routes.lists.some((item) => item.address === address)) {
      throw routeError(`${address} is already in use`);
    }
  }

  return {
    read(): Promise<AddressRoutes> {
      return withLock("address-routes", () => readUnlocked());
    },

    async addDomain(domain: string, companyDomain: string): Promise<AddressRoutes> {
      const normalized = domain.trim().toLowerCase();
      if (!isDomain(normalized)) {
        throw routeError("Enter a domain such as example.com");
      }
      if (normalized === companyDomain.trim().toLowerCase()) {
        throw routeError("The company domain is already accepted");
      }
      return withLock("address-routes", async () => {
        const routes = await readUnlocked();
        if (!routes.domains.includes(normalized)) {
          routes.domains.push(normalized);
        }
        return writeUnlocked(routes);
      });
    },

    async removeDomain(domain: string): Promise<AddressRoutes> {
      const normalized = domain.trim().toLowerCase();
      return withLock("address-routes", async () => {
        const routes = await readUnlocked();
        routes.domains = routes.domains.filter((item) => item !== normalized);
        routes.aliases = routes.aliases.filter((item) => domainOf(item.address) !== normalized);
        routes.lists = routes.lists.filter((item) => domainOf(item.address) !== normalized);
        routes.catchAllMailboxes = routes.catchAllMailboxes.filter((item) => item.domain !== normalized);
        return writeUnlocked(routes);
      });
    },

    async addAlias(alias: AddressAlias, companyDomain: string): Promise<AddressRoutes> {
      const address = normalizeAddress(alias.address);
      const mailboxAddress = normalizeAddress(alias.mailboxAddress);
      if (!isValidAddress(address) || !isValidAddress(mailboxAddress)) {
        throw routeError("Enter a valid alias and mailbox");
      }
      if (address === mailboxAddress) {
        throw routeError("An alias must point at a different mailbox");
      }
      return withLock("address-routes", async () => {
        const routes = await readUnlocked();
        assertAcceptedDomain(domainOf(address), companyDomain, routes);
        assertAddressAvailable(address, routes);
        routes.aliases.push({ address, mailboxAddress });
        return writeUnlocked(routes);
      });
    },

    async removeAlias(address: string): Promise<AddressRoutes> {
      const normalized = normalizeAddress(address);
      return withLock("address-routes", async () => {
        const routes = await readUnlocked();
        routes.aliases = routes.aliases.filter((item) => item.address !== normalized);
        return writeUnlocked(routes);
      });
    },

    async addList(list: AddressList, companyDomain: string): Promise<AddressRoutes> {
      const address = normalizeAddress(list.address);
      const mailboxAddresses = [...new Set(list.mailboxAddresses.map((item) => normalizeAddress(item)).filter((item) => isValidAddress(item)))];
      if (!isValidAddress(address) || mailboxAddresses.length === 0) {
        throw routeError("Enter a list address and at least one mailbox");
      }
      return withLock("address-routes", async () => {
        const routes = await readUnlocked();
        assertAcceptedDomain(domainOf(address), companyDomain, routes);
        assertAddressAvailable(address, routes);
        routes.lists.push({ address, mailboxAddresses });
        return writeUnlocked(routes);
      });
    },

    async removeList(address: string): Promise<AddressRoutes> {
      const normalized = normalizeAddress(address);
      return withLock("address-routes", async () => {
        const routes = await readUnlocked();
        routes.lists = routes.lists.filter((item) => item.address !== normalized);
        return writeUnlocked(routes);
      });
    },

    async addCatchAll(catchAll: CatchAllMailbox, companyDomain: string): Promise<AddressRoutes> {
      const domain = catchAll.domain.trim().toLowerCase();
      const mailboxAddress = normalizeAddress(catchAll.mailboxAddress);
      if (!isDomain(domain) || !isValidAddress(mailboxAddress)) {
        throw routeError("Enter the domain and the mailbox that should receive unmatched mail");
      }
      return withLock("address-routes", async () => {
        const routes = await readUnlocked();
        assertAcceptedDomain(domain, companyDomain, routes);
        routes.catchAllMailboxes = routes.catchAllMailboxes.filter((item) => item.domain !== domain);
        routes.catchAllMailboxes.push({ domain, mailboxAddress });
        return writeUnlocked(routes);
      });
    },

    async removeCatchAll(domain: string): Promise<AddressRoutes> {
      const normalized = domain.trim().toLowerCase();
      return withLock("address-routes", async () => {
        const routes = await readUnlocked();
        routes.catchAllMailboxes = routes.catchAllMailboxes.filter((item) => item.domain !== normalized);
        return writeUnlocked(routes);
      });
    },

    async addBlockedSender(value: string): Promise<AddressRoutes> {
      const trimmed = value.trim().toLowerCase();
      return withLock("address-routes", async () => {
        const routes = await readUnlocked();
        if (trimmed.includes("@")) {
          const address = normalizeAddress(trimmed);
          if (!isValidAddress(address)) {
            throw routeError("Enter a valid sender address");
          }
          if (!routes.blockedSenders.includes(address)) {
            routes.blockedSenders.push(address);
          }
        } else if (isIP(trimmed)) {
          if (!routes.blockedRemoteAddresses.includes(trimmed)) {
            routes.blockedRemoteAddresses.push(trimmed);
          }
        } else if (isDomain(trimmed)) {
          if (!routes.blockedDomains.includes(trimmed)) {
            routes.blockedDomains.push(trimmed);
          }
        } else {
          const remoteAddress = trimmed.replace(/^::ffff:/, "");
          if (!remoteAddress) {
            throw routeError("Enter an address, a domain, or a remote address");
          }
          if (!routes.blockedRemoteAddresses.includes(remoteAddress)) {
            routes.blockedRemoteAddresses.push(remoteAddress);
          }
        }
        return writeUnlocked(routes);
      });
    },

    async removeBlockedSender(value: string): Promise<AddressRoutes> {
      const trimmed = value.trim().toLowerCase().replace(/^::ffff:/, "");
      const address = normalizeAddress(trimmed);
      return withLock("address-routes", async () => {
        const routes = await readUnlocked();
        routes.blockedSenders = routes.blockedSenders.filter((item) => item !== address);
        routes.blockedDomains = routes.blockedDomains.filter((item) => item !== trimmed);
        routes.blockedRemoteAddresses = routes.blockedRemoteAddresses.filter((item) => item !== trimmed);
        return writeUnlocked(routes);
      });
    }
  };
}

export class AddressRouteRepository {
  private readonly repository: ReturnType<typeof createAddressRouteRepository>;

  constructor(storageDirectory: string) {
    this.repository = createAddressRouteRepository(storageDirectory);
  }

  read() {
    return this.repository.read();
  }

  addDomain(domain: string, companyDomain: string) {
    return this.repository.addDomain(domain, companyDomain);
  }

  removeDomain(domain: string) {
    return this.repository.removeDomain(domain);
  }

  addAlias(alias: AddressAlias, companyDomain: string) {
    return this.repository.addAlias(alias, companyDomain);
  }

  removeAlias(address: string) {
    return this.repository.removeAlias(address);
  }

  addList(list: AddressList, companyDomain: string) {
    return this.repository.addList(list, companyDomain);
  }

  removeList(address: string) {
    return this.repository.removeList(address);
  }

  addCatchAll(catchAll: CatchAllMailbox, companyDomain: string) {
    return this.repository.addCatchAll(catchAll, companyDomain);
  }

  removeCatchAll(domain: string) {
    return this.repository.removeCatchAll(domain);
  }

  addBlockedSender(value: string) {
    return this.repository.addBlockedSender(value);
  }

  removeBlockedSender(value: string) {
    return this.repository.removeBlockedSender(value);
  }
}
