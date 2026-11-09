import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { AccountRole } from "../../../src/components/account/enums/accountRole.js";
import { readJson, writeJson } from "../../../src/components/jsonFile/index.js";
import { SessionRepository } from "../../../src/components/session/index.js";
import type { SessionRecord, SessionRepository as SessionRepositoryContract } from "../../../src/components/session/interfaces/sessionRepository.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";

describe("session repository interface", () => {
  it("creates, reads, expires, and removes sessions", async () => {
    const storageDirectory = await createTemporaryStorage();
    const repository: SessionRepositoryContract = new SessionRepository(storageDirectory);
    try {
      assert.equal(await repository.read("not-a-session"), null);
      assert.equal(await repository.read(""), null);
      const identifier = await repository.create("Ada@Acme.Test", AccountRole.Administrator);
      assert.match(identifier, /^[a-f0-9]{48}$/);
      const session = await repository.read(identifier);
      assert.equal(session?.address, "Ada@Acme.Test");
      assert.equal(session?.role, AccountRole.Administrator);
      assert.equal((session?.expiresAt || 0) > Date.now(), true);

      const member = await repository.create("bea@acme.test", AccountRole.Member);
      await repository.removeForAddress("  BEA@ACME.TEST  ");
      assert.equal(await repository.read(member), null);
      assert.notEqual(await repository.read(identifier), null);
      await repository.remove(identifier);
      assert.equal(await repository.read(identifier), null);
      await repository.remove("");
      await repository.removeForAddress("");

      const expired = await repository.create("ada@acme.test", AccountRole.Administrator);
      const stored = await readJson<{ sessions: Record<string, SessionRecord> }>(path.join(storageDirectory, "sessions.json"));
      stored.sessions[expired].expiresAt = Date.now() - 1000;
      await writeJson(path.join(storageDirectory, "sessions.json"), stored);
      assert.equal(await repository.read(expired), null);
      const afterExpiry = await readJson<{ sessions: Record<string, SessionRecord> }>(path.join(storageDirectory, "sessions.json"));
      assert.equal(afterExpiry.sessions[expired], undefined);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
