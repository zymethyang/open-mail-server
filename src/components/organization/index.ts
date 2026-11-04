import { rm } from "node:fs/promises";
import path from "node:path";
import type { OrganizationRepository as OrganizationRepositoryContract } from "./interfaces/organizationRepository.js";
import type { OrganizationRecord } from "./interfaces/organizationRecord.js";
import { cleanDisplayName } from "../text/index.js";
import { withLock } from "../jsonFile/index.js";
import { readJson, writeJson } from "../jsonFile/index.js";

function isDomain(value: string): boolean {
  return value.length > 0 && value.length <= 253 && /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/.test(value);
}

export function createOrganizationRepository(storageDirectory: string): OrganizationRepositoryContract {
  const filePath = path.join(storageDirectory, "organization.json");

  return {
    async read() {
      return withLock("organization", async () => {
        try {
          const stored = await readJson<OrganizationRecord>(filePath);
          if (!stored || !isDomain(stored.domain)) {
            return null;
          }
          return {
            domain: stored.domain,
            displayName: cleanDisplayName(stored.displayName) || stored.domain,
            createdAt: stored.createdAt || new Date(0).toISOString()
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
          }
          throw error;
        }
      });
    },

    async create({ domain, displayName, requiredDomain }) {
      const normalized = domain.trim().toLowerCase();
      const safeName = cleanDisplayName(displayName);
      if (!isDomain(normalized)) {
        throw Object.assign(new Error("Enter the company domain, such as acme.com"), { statusCode: 400 });
      }
      if (requiredDomain && normalized !== requiredDomain) {
        throw Object.assign(new Error(`This installation is configured for ${requiredDomain}`), { statusCode: 400 });
      }
      if (!safeName) {
        throw Object.assign(new Error("Organization name is required"), { statusCode: 400 });
      }
      return withLock("organization", async () => {
        try {
          await readJson(filePath);
          throw Object.assign(new Error("This server already has a company domain"), { statusCode: 409 });
        } catch (error) {
          if ((error as { statusCode?: number }).statusCode) {
            throw error;
          }
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
        const record: OrganizationRecord = {
          domain: normalized,
          displayName: safeName,
          createdAt: new Date().toISOString()
        };
        await writeJson(filePath, record);
        return record;
      });
    },

    async remove() {
      await withLock("organization", async () => {
        await rm(filePath, { force: true });
      });
    }
  };
}

export class OrganizationRepository implements OrganizationRepositoryContract {
  private readonly repository: OrganizationRepositoryContract;

  constructor(storageDirectory: string) {
    this.repository = createOrganizationRepository(storageDirectory);
  }

  read() {
    return this.repository.read();
  }

  create(input: Parameters<OrganizationRepositoryContract["create"]>[0]) {
    return this.repository.create(input);
  }

  remove() {
    return this.repository.remove();
  }
}
