import { randomBytes } from "node:crypto";
import path from "node:path";
import type { AccountRole } from "../account/enums/accountRole.js";
import type { SessionRecord, SessionRepository as SessionRepositoryContract } from "./interfaces/sessionRepository.js";
import type { SessionFile } from "./interfaces/sessionFile.js";
import { withLock } from "../jsonFile/index.js";
import { readJson, writeJson } from "../jsonFile/index.js";

function createSessionRepository(storageDirectory: string): SessionRepositoryContract {
  const filePath = path.join(storageDirectory, "sessions.json");
  const lifetimeMilliseconds = 7 * 24 * 60 * 60 * 1000;

  async function readSessions(): Promise<Record<string, SessionRecord>> {
    try {
      const stored = await readJson<SessionFile>(filePath);
      return stored.sessions && typeof stored.sessions === "object" ? stored.sessions : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  return {
    async create(address, role) {
      return withLock("sessions", async () => {
        const sessions = await readSessions();
        const identifier = randomBytes(24).toString("hex");
        sessions[identifier] = {
          address,
          role,
          expiresAt: Date.now() + lifetimeMilliseconds
        };
        await writeJson(filePath, { sessions });
        return identifier;
      });
    },

    async read(identifier) {
      if (!identifier || !/^[a-f0-9]{48}$/.test(identifier)) {
        return null;
      }
      return withLock("sessions", async () => {
        const sessions = await readSessions();
        const session = sessions[identifier];
        if (!session) {
          return null;
        }
        if (session.expiresAt <= Date.now()) {
          delete sessions[identifier];
          await writeJson(filePath, { sessions });
          return null;
        }
        return session;
      });
    },

    async remove(identifier) {
      if (!identifier) {
        return;
      }
      return withLock("sessions", async () => {
        const sessions = await readSessions();
        delete sessions[identifier];
        await writeJson(filePath, { sessions });
      });
    },

    async removeForAddress(address) {
      const normalized = address.trim().toLowerCase();
      if (!normalized) {
        return;
      }
      return withLock("sessions", async () => {
        const sessions = await readSessions();
        for (const [identifier, session] of Object.entries(sessions)) {
          if (session.address === normalized) {
            delete sessions[identifier];
          }
        }
        await writeJson(filePath, { sessions });
      });
    }
  };
}

export class SessionRepository implements SessionRepositoryContract {
  private readonly repository: SessionRepositoryContract;

  constructor(storageDirectory: string) {
    this.repository = createSessionRepository(storageDirectory);
  }

  create(address: string, role: AccountRole) {
    return this.repository.create(address, role);
  }

  read(identifier: string) {
    return this.repository.read(identifier);
  }

  remove(identifier: string) {
    return this.repository.remove(identifier);
  }

  removeForAddress(address: string) {
    return this.repository.removeForAddress(address);
  }
}
