import path from "node:path";
import { AccountRole } from "./enums/accountRole.js";
import type { AccountRepository as AccountRepositoryContract } from "./interfaces/accountRepository.js";
import type { AccountFile } from "./interfaces/accountFile.js";
import type { AccountRecord, PublicAccount } from "./interfaces/accountRecord.js";
import { cleanDisplayName } from "../text/index.js";
import { isValidAddress, normalizeAddress } from "../text/index.js";
import { decodeBase32, oneTimePasswordMatches as secretMatchesCode } from "../oneTimePassword/utils/oneTimePasswordCode.js";
import { hashPassword, passwordsMatch } from "./utils/passwordHasher.js";
import { withLock } from "../jsonFile/index.js";
import { readJson, writeJson } from "../jsonFile/index.js";

function publicAccount(record: AccountRecord): PublicAccount {
  return {
    address: record.address,
    displayName: record.displayName,
    role: record.role === AccountRole.Administrator ? AccountRole.Administrator : AccountRole.Member,
    createdAt: record.createdAt,
    disabled: Boolean(record.disabled),
    oneTimePasswordEnabled: Boolean(record.oneTimePasswordEnabled)
  };
}

function assertPassword(password: string): void {
  if (password.length < 8 || password.length > 200) {
    throw Object.assign(new Error("Password must be 8 to 200 characters"), { statusCode: 400 });
  }
}

function createAccountRepository(storageDirectory: string): AccountRepositoryContract {
  const filePath = path.join(storageDirectory, "accounts.json");

  async function readRecords(): Promise<AccountRecord[]> {
    try {
      const stored = await readJson<AccountFile>(filePath);
      return Array.isArray(stored.accounts) ? stored.accounts : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  return {
    async listAccounts() {
      return withLock("accounts", async () => {
        const accounts = await readRecords();
        return accounts.map(publicAccount);
      });
    },

    async hasAccounts() {
      const accounts = await this.listAccounts();
      return accounts.length > 0;
    },

    async findAccount(address) {
      const normalized = normalizeAddress(address);
      return withLock("accounts", async () => {
        const accounts = await readRecords();
        const record = accounts.find((account) => account.address === normalized);
        return record ? publicAccount(record) : null;
      });
    },

    async exists(address) {
      const account = await this.findAccount(address);
      return Boolean(account);
    },

    async verifyCredentials(address, password) {
      const normalized = normalizeAddress(address);
      return withLock("accounts", async () => {
        const accounts = await readRecords();
        const record = accounts.find((account) => account.address === normalized);
        const matches = passwordsMatch(password, record?.passwordSalt, record?.passwordHash);
        if (!record || record.disabled || !matches) {
          return null;
        }
        return publicAccount(record);
      });
    },

    async createAccount({ address, displayName, password, role, domain }) {
      const normalized = normalizeAddress(address);
      const safeName = cleanDisplayName(displayName);
      if (!isValidAddress(normalized)) {
        throw Object.assign(new Error("Enter a valid email address"), { statusCode: 400 });
      }
      const addressDomain = normalized.split("@")[1];
      if (addressDomain !== domain) {
        throw Object.assign(new Error(`Address must use the company domain ${domain}`), { statusCode: 400 });
      }
      assertPassword(password);
      if (!safeName) {
        throw Object.assign(new Error("Name is required"), { statusCode: 400 });
      }
      return withLock("accounts", async () => {
        const accounts = await readRecords();
        if (accounts.some((account) => account.address === normalized)) {
          throw Object.assign(new Error("That mailbox already exists"), { statusCode: 409 });
        }
        const passwordRecord = hashPassword(password);
        const record: AccountRecord = {
          address: normalized,
          displayName: safeName,
          role,
          createdAt: new Date().toISOString(),
          passwordSalt: passwordRecord.salt,
          passwordHash: passwordRecord.hash,
          disabled: false,
          oneTimePasswordEnabled: false,
          oneTimePasswordSecret: "",
          oneTimePasswordPendingSecret: ""
        };
        accounts.push(record);
        await writeJson(filePath, { accounts });
        return publicAccount(record);
      });
    },

    async replacePassword(address, password) {
      const normalized = normalizeAddress(address);
      assertPassword(password);
      return withLock("accounts", async () => {
        const accounts = await readRecords();
        const record = accounts.find((account) => account.address === normalized);
        if (!record) {
          throw Object.assign(new Error("Mailbox not found"), { statusCode: 404 });
        }
        const passwordRecord = hashPassword(password);
        record.passwordSalt = passwordRecord.salt;
        record.passwordHash = passwordRecord.hash;
        await writeJson(filePath, { accounts });
        return publicAccount(record);
      });
    },

    async setDisabled(address, disabled) {
      const normalized = normalizeAddress(address);
      return withLock("accounts", async () => {
        const accounts = await readRecords();
        const record = accounts.find((account) => account.address === normalized);
        if (!record) {
          throw Object.assign(new Error("Mailbox not found"), { statusCode: 404 });
        }
        if (disabled && record.role === AccountRole.Administrator) {
          const anotherAdministrator = accounts.some(
            (account) => account.address !== record.address && account.role === AccountRole.Administrator && !account.disabled
          );
          if (!anotherAdministrator) {
            throw Object.assign(new Error("Keep at least one active administrator"), { statusCode: 409 });
          }
        }
        record.disabled = disabled;
        await writeJson(filePath, { accounts });
        return publicAccount(record);
      });
    },

    async storePendingOneTimePassword(address, secret) {
      const normalized = normalizeAddress(address);
      return withLock("accounts", async () => {
        const accounts = await readRecords();
        const record = accounts.find((account) => account.address === normalized);
        if (!record) {
          throw Object.assign(new Error("Mailbox not found"), { statusCode: 404 });
        }
        record.oneTimePasswordPendingSecret = secret;
        await writeJson(filePath, { accounts });
      });
    },

    async confirmOneTimePassword(address, code) {
      const normalized = normalizeAddress(address);
      return withLock("accounts", async () => {
        const accounts = await readRecords();
        const record = accounts.find((account) => account.address === normalized);
        const pendingSecret = record?.oneTimePasswordPendingSecret || "";
        if (!record || !pendingSecret) {
          throw Object.assign(new Error("Start authenticator setup first"), { statusCode: 400 });
        }
        if (!secretMatchesCode(decodeBase32(pendingSecret), code)) {
          return null;
        }
        record.oneTimePasswordSecret = pendingSecret;
        record.oneTimePasswordPendingSecret = "";
        record.oneTimePasswordEnabled = true;
        await writeJson(filePath, { accounts });
        return publicAccount(record);
      });
    },

    async oneTimePasswordMatches(address, code) {
      const normalized = normalizeAddress(address);
      return withLock("accounts", async () => {
        const accounts = await readRecords();
        const record = accounts.find((account) => account.address === normalized);
        const secret = record?.oneTimePasswordSecret || "";
        if (!record || !record.oneTimePasswordEnabled || !secret) {
          return false;
        }
        return secretMatchesCode(decodeBase32(secret), code);
      });
    },

    async clearOneTimePassword(address) {
      const normalized = normalizeAddress(address);
      return withLock("accounts", async () => {
        const accounts = await readRecords();
        const record = accounts.find((account) => account.address === normalized);
        if (!record) {
          throw Object.assign(new Error("Mailbox not found"), { statusCode: 404 });
        }
        record.oneTimePasswordSecret = "";
        record.oneTimePasswordPendingSecret = "";
        record.oneTimePasswordEnabled = false;
        await writeJson(filePath, { accounts });
        return publicAccount(record);
      });
    }
  };
}

export class AccountRepository implements AccountRepositoryContract {
  private readonly repository: AccountRepositoryContract;

  constructor(storageDirectory: string) {
    this.repository = createAccountRepository(storageDirectory);
  }

  listAccounts() {
    return this.repository.listAccounts();
  }

  hasAccounts() {
    return this.repository.hasAccounts();
  }

  findAccount(address: string) {
    return this.repository.findAccount(address);
  }

  exists(address: string) {
    return this.repository.exists(address);
  }

  verifyCredentials(address: string, password: string) {
    return this.repository.verifyCredentials(address, password);
  }

  createAccount(input: Parameters<AccountRepositoryContract["createAccount"]>[0]) {
    return this.repository.createAccount(input);
  }

  replacePassword(address: string, password: string) {
    return this.repository.replacePassword(address, password);
  }

  setDisabled(address: string, disabled: boolean) {
    return this.repository.setDisabled(address, disabled);
  }

  storePendingOneTimePassword(address: string, secret: string) {
    return this.repository.storePendingOneTimePassword(address, secret);
  }

  confirmOneTimePassword(address: string, code: string) {
    return this.repository.confirmOneTimePassword(address, code);
  }

  oneTimePasswordMatches(address: string, code: string) {
    return this.repository.oneTimePasswordMatches(address, code);
  }

  clearOneTimePassword(address: string) {
    return this.repository.clearOneTimePassword(address);
  }
}
