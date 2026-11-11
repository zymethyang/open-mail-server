import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { createStorageBackup, listStorageBackups, restoreStorageBackup } from "../../../src/components/backup/index.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";

describe("storage backup", () => {
  it("backs up the storage key with the mail data and restores both", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      await writeFile(path.join(storageDirectory, "storage-key"), Buffer.alloc(32, 7));
      await writeFile(path.join(storageDirectory, "accounts.json"), Buffer.from("{\"accounts\":[]}"));
      const createdAt = new Date("2026-11-11T12:00:00.000Z");
      const backupDirectory = await createStorageBackup(storageDirectory, createdAt);
      assert.equal(path.basename(backupDirectory), "2026-11-11T12-00-00-000Z");
      assert.deepEqual(await listStorageBackups(storageDirectory), ["2026-11-11T12-00-00-000Z"]);

      await writeFile(path.join(storageDirectory, "storage-key"), Buffer.alloc(32, 9));
      await writeFile(path.join(storageDirectory, "accounts.json"), Buffer.from("changed"));
      await writeFile(path.join(storageDirectory, "extra.txt"), Buffer.from("after the backup"));
      await restoreStorageBackup(storageDirectory, backupDirectory);

      assert.deepEqual(await readFile(path.join(storageDirectory, "storage-key")), Buffer.alloc(32, 7));
      assert.equal(await readFile(path.join(storageDirectory, "accounts.json"), "utf8"), "{\"accounts\":[]}");
      await assert.rejects(() => readFile(path.join(storageDirectory, "extra.txt")));
      assert.deepEqual(await listStorageBackups(storageDirectory), ["2026-11-11T12-00-00-000Z"]);
      await assert.rejects(() => restoreStorageBackup(storageDirectory, storageDirectory), /storage backup directory/);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("lists nothing before the first backup", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      assert.deepEqual(await listStorageBackups(storageDirectory), []);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
