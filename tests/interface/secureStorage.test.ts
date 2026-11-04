import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isSealedEnvelope, openSealedValue, openSecureStorage, sealValue } from "../../src/components/secureStorage/index.js";
import { parseStoredJson, readJson, writeJson } from "../../src/components/jsonFile/index.js";
import { createTemporaryStorage, removeTemporaryStorage, testStorageKey } from "../support/temporaryStorage.js";

describe("secure storage interface", { concurrency: 1 }, () => {
  it("seals values and still reads an older plain file", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      const sealed = await sealValue({ subject: "Hello", text: "Café" });
      assert.equal(isSealedEnvelope(sealed), true);
      assert.equal(isSealedEnvelope({ sealed: false, nonce: "a", ciphertext: "b" }), false);
      assert.equal(isSealedEnvelope(null), false);
      assert.deepEqual(await openSealedValue<{ subject: string }>(sealed), { subject: "Hello", text: "Café" });

      const filePath = path.join(storageDirectory, "plain.json");
      await writeFile(filePath, `${JSON.stringify({ plain: true })}\n`, "utf8");
      assert.deepEqual(await readJson<{ plain: boolean }>(filePath), { plain: true });
      await writeJson(path.join(storageDirectory, "sealed.json"), { sealedValue: 1 });
      assert.deepEqual(await readJson<{ sealedValue: number }>(path.join(storageDirectory, "sealed.json")), { sealedValue: 1 });
      assert.deepEqual(await parseStoredJson(JSON.stringify(sealed)), { subject: "Hello", text: "Café" });

      const truncated = { ...sealed, ciphertext: Buffer.from("short").toString("base64") };
      await assert.rejects(() => openSealedValue(truncated), /incomplete/);
      const tampered = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext, "base64").fill(1).toString("base64") };
      await assert.rejects(() => openSealedValue(tampered));
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("rejects a storage key file that is not 32 bytes and then accepts the test key", async () => {
    const storageDirectory = await mkdtemp(path.join(os.tmpdir(), "email-server-key-"));
    await writeFile(path.join(storageDirectory, "storage-key"), Buffer.from("short"));
    try {
      await assert.rejects(() => openSecureStorage(storageDirectory), /32 bytes/);
      await writeFile(path.join(storageDirectory, "storage-key"), testStorageKey);
      await openSecureStorage(storageDirectory);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("does not create a new key when sealed mail is already stored", async () => {
    const storageDirectory = await mkdtemp(path.join(os.tmpdir(), "email-server-sealed-"));
    await writeFile(
      path.join(storageDirectory, "accounts.json"),
      `${JSON.stringify({ sealed: true, nonce: "a", ciphertext: "b" })}\n`,
      "utf8"
    );
    try {
      await assert.rejects(() => openSecureStorage(storageDirectory), /storage key file is missing/);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
