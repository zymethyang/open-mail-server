import assert from "node:assert/strict";
import { access, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { readJson, recoverJsonTransaction, writeJson } from "../../../src/components/jsonFile/index.js";
import { JsonTransactionSuffix } from "../../../src/components/jsonFile/enums/jsonTransactionSuffix.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";

describe("json rollback", { concurrency: 1 }, () => {
  it("replaces a file and leaves no backup behind", async () => {
    const storageDirectory = await createTemporaryStorage();
    const filePath = path.join(storageDirectory, "notes.json");
    try {
      await writeJson(filePath, { version: 1 });
      await writeJson(filePath, { version: 2 });
      assert.deepEqual(await readJson(filePath), { version: 2 });
      await assert.rejects(access(`${filePath}${JsonTransactionSuffix.Backup}`), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
      await assert.rejects(access(`${filePath}${JsonTransactionSuffix.Temporary}`), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("restores the previous file when a replacement was interrupted", async () => {
    const storageDirectory = await createTemporaryStorage();
    const filePath = path.join(storageDirectory, "notes.json");
    try {
      await writeJson(filePath, { version: 1 });
      await rename(filePath, `${filePath}${JsonTransactionSuffix.Backup}`);
      await writeFile(`${filePath}${JsonTransactionSuffix.Temporary}`, "{not-finished", "utf8");
      assert.deepEqual(await readJson(filePath), { version: 1 });
      await assert.rejects(access(`${filePath}${JsonTransactionSuffix.Backup}`), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
      await assert.rejects(access(`${filePath}${JsonTransactionSuffix.Temporary}`), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("keeps the completed file when a backup and a temporary file are still present", async () => {
    const storageDirectory = await createTemporaryStorage();
    const filePath = path.join(storageDirectory, "notes.json");
    try {
      await writeJson(filePath, { version: 2 });
      await writeFile(`${filePath}${JsonTransactionSuffix.Backup}`, "previous", "utf8");
      await writeFile(`${filePath}${JsonTransactionSuffix.Temporary}`, "next", "utf8");
      await recoverJsonTransaction(filePath);
      assert.deepEqual(await readJson(filePath), { version: 2 });
      await assert.rejects(access(`${filePath}${JsonTransactionSuffix.Backup}`), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
      await assert.rejects(access(`${filePath}${JsonTransactionSuffix.Temporary}`), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
