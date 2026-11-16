import assert from "node:assert/strict";
import { access, mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  createStorageBackup,
  deleteStorageBackup,
  endRestore,
  isRestoreInProgress,
  listStorageBackups,
  parseBackupStamp,
  resolveBackupDirectory,
  restoreStorageBackup,
  tryBeginRestore
} from "../../../src/components/backup/index.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";

describe("storage backup", () => {
  it("parses backup folder stamps back to the original instant", () => {
    const createdAt = new Date("2026-11-12T04:50:39.447Z");
    const stamp = createdAt.toISOString().replace(/[:.]/g, "-");
    assert.equal(stamp, "2026-11-12T04-50-39-447Z");
    assert.equal(parseBackupStamp(stamp)?.toISOString(), createdAt.toISOString());
    assert.equal(parseBackupStamp("not-a-stamp"), null);
  });

  it("resolves only stamp-named directories strictly inside the backups root", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      const stamp = "2026-11-11T12-00-00-000Z";
      await mkdir(path.join(storageDirectory, "backups", stamp), { recursive: true });
      assert.equal(
        resolveBackupDirectory(storageDirectory, stamp),
        path.resolve(storageDirectory, "backups", stamp)
      );
      for (const invalid of [".", "..", "../outside", "backups/../outside", "a/b", "a\\b", "not-a-stamp"]) {
        assert.throws(() => resolveBackupDirectory(storageDirectory, invalid), /Choose a backup from the list/);
      }
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("excludes the storage key from new backups and leaves the live key unchanged on restore", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      const liveKey = Buffer.alloc(32, 9);
      await writeFile(path.join(storageDirectory, "storage-key"), liveKey);
      await writeFile(path.join(storageDirectory, "accounts.json"), Buffer.from("{\"accounts\":[]}"));
      const createdAt = new Date("2026-11-11T12:00:00.000Z");
      const backupDirectory = await createStorageBackup(storageDirectory, createdAt);
      assert.equal(path.basename(backupDirectory), "2026-11-11T12-00-00-000Z");
      assert.deepEqual(await listStorageBackups(storageDirectory), ["2026-11-11T12-00-00-000Z"]);
      await assert.rejects(() => access(path.join(backupDirectory, "storage-key")));
      assert.equal(await readFile(path.join(backupDirectory, "accounts.json"), "utf8"), "{\"accounts\":[]}");

      await writeFile(path.join(storageDirectory, "accounts.json"), Buffer.from("changed"));
      await writeFile(path.join(storageDirectory, "extra.txt"), Buffer.from("after the backup"));
      await writeFile(path.join(backupDirectory, "storage-key"), Buffer.alloc(32, 7));
      await restoreStorageBackup(storageDirectory, "2026-11-11T12-00-00-000Z");

      assert.deepEqual(await readFile(path.join(storageDirectory, "storage-key")), liveKey);
      assert.equal(await readFile(path.join(storageDirectory, "accounts.json"), "utf8"), "{\"accounts\":[]}");
      await assert.rejects(() => readFile(path.join(storageDirectory, "extra.txt")));
      assert.deepEqual(await listStorageBackups(storageDirectory), ["2026-11-11T12-00-00-000Z"]);
      await assert.rejects(() => restoreStorageBackup(storageDirectory, ".."), /Choose a backup from the list/);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("deletes one stamp-named backup without touching the live store", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      await writeFile(path.join(storageDirectory, "storage-key"), Buffer.alloc(32, 7));
      await writeFile(path.join(storageDirectory, "accounts.json"), Buffer.from("{\"accounts\":[]}"));
      const first = await createStorageBackup(storageDirectory, new Date("2026-11-11T12:00:00.000Z"));
      const second = await createStorageBackup(storageDirectory, new Date("2026-11-11T13:00:00.000Z"));
      await writeFile(path.join(storageDirectory, "backups", "notes.txt"), Buffer.from("ignore me"));
      await mkdir(path.join(storageDirectory, "backups", "not-a-stamp"), { recursive: true });
      assert.deepEqual(await listStorageBackups(storageDirectory), [
        path.basename(first),
        path.basename(second)
      ]);
      await deleteStorageBackup(storageDirectory, path.basename(first));
      assert.deepEqual(await listStorageBackups(storageDirectory), [path.basename(second)]);
      assert.deepEqual(await readFile(path.join(storageDirectory, "storage-key")), Buffer.alloc(32, 7));
      assert.equal(await readFile(path.join(storageDirectory, "accounts.json"), "utf8"), "{\"accounts\":[]}");
      await assert.rejects(() => deleteStorageBackup(storageDirectory, ".."), /Choose a backup from the list/);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("tracks an exclusive restore lock for callers", () => {
    endRestore();
    assert.equal(isRestoreInProgress(), false);
    assert.equal(tryBeginRestore(), true);
    try {
      assert.equal(isRestoreInProgress(), true);
      assert.equal(tryBeginRestore(), false);
    } finally {
      endRestore();
    }
    assert.equal(isRestoreInProgress(), false);
  });

  it("lists nothing before the first backup", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      assert.deepEqual(await listStorageBackups(storageDirectory), []);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("backs up certificate files and mailbox index trees without the storage key", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      await mkdir(path.join(storageDirectory, "certificates"), { recursive: true });
      await writeFile(path.join(storageDirectory, "certificates", "certificate.pem"), "certificate");
      await writeFile(path.join(storageDirectory, "certificates", "private-key.pem"), "private-key");
      await mkdir(path.join(storageDirectory, "mailboxes", "ada@acme.test", "inbox"), { recursive: true });
      await writeFile(path.join(storageDirectory, "mailboxes", "ada@acme.test", "inbox", "index.json"), "[]");
      const backupDirectory = await createStorageBackup(storageDirectory, new Date("2026-11-11T14:00:00.000Z"));
      assert.equal(
        await readFile(path.join(backupDirectory, "certificates", "certificate.pem"), "utf8"),
        "certificate"
      );
      assert.equal(
        await readFile(path.join(backupDirectory, "mailboxes", "ada@acme.test", "inbox", "index.json"), "utf8"),
        "[]"
      );
      await assert.rejects(() => access(path.join(backupDirectory, "storage-key")));
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("creates a backup while a live storage file remains open", async () => {
    const storageDirectory = await createTemporaryStorage();
    const accountsPath = path.join(storageDirectory, "accounts.json");
    await writeFile(accountsPath, Buffer.from("{\"accounts\":[]}"));
    const openHandle = await open(accountsPath, "r+");
    try {
      const backupDirectory = await createStorageBackup(storageDirectory, new Date("2026-11-11T15:00:00.000Z"));
      assert.equal(await readFile(path.join(backupDirectory, "accounts.json"), "utf8"), "{\"accounts\":[]}");
      await assert.rejects(() => access(path.join(backupDirectory, "storage-key")));
    } finally {
      await openHandle.close();
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
