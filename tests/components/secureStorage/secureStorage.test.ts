import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { storageFormatVersion } from "../../../src/components/secureStorage/constants/storageCipher.js";
import { isSealedEnvelope, openSealedValue, openSecureStorage, sealValue, type SealedEnvelope } from "../../../src/components/secureStorage/index.js";
import { parseStoredJson, readJson, writeJson } from "../../../src/components/jsonFile/index.js";
import { createTemporaryStorage, removeTemporaryStorage, testStorageKey } from "../../support/temporaryStorage.js";

function originalEnvelope(value: unknown): SealedEnvelope {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", testStorageKey, nonce);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), "utf8")), cipher.final()]);
  return {
    sealed: true,
    nonce: nonce.toString("base64"),
    ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64")
  };
}

describe("secure storage interface", { concurrency: 1 }, () => {
  it("seals values and still reads an older plain file", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      const sealed = await sealValue({ subject: "Hello", text: "Café" });
      const again = await sealValue({ subject: "Hello", text: "Café" });
      assert.equal(sealed.version, storageFormatVersion);
      assert.notEqual(sealed.nonce, again.nonce);
      assert.equal(isSealedEnvelope(sealed), true);
      assert.equal(isSealedEnvelope({ sealed: false, nonce: "a", ciphertext: "b" }), false);
      assert.equal(isSealedEnvelope(null), false);
      assert.deepEqual(await openSealedValue<{ subject: string }>(sealed), { subject: "Hello", text: "Café" });
      const forAccounts = await sealValue({ owner: "ada" }, "accounts.json");
      assert.deepEqual(await openSealedValue(forAccounts, "accounts.json"), { owner: "ada" });
      await assert.rejects(() => openSealedValue(forAccounts, "settings.json"), /could not be opened/);
      await assert.rejects(() => openSealedValue({ ...sealed, version: 9 }), /not supported/);
      await assert.rejects(() => openSealedValue({ ...sealed, authenticationTag: "" }), /incomplete/);
      const legacy = originalEnvelope({ legacy: true });
      assert.equal(legacy.version, undefined);
      assert.deepEqual(await openSealedValue(legacy), { legacy: true });
      await assert.rejects(() => openSealedValue({ ...legacy, ciphertext: Buffer.from("short").toString("base64") }), /incomplete/);

      const filePath = path.join(storageDirectory, "plain.json");
      await writeFile(filePath, `${JSON.stringify({ plain: true })}\n`, "utf8");
      assert.deepEqual(await readJson<{ plain: boolean }>(filePath), { plain: true });
      await writeJson(path.join(storageDirectory, "sealed.json"), { sealedValue: 1 });
      assert.deepEqual(await readJson<{ sealedValue: number }>(path.join(storageDirectory, "sealed.json")), { sealedValue: 1 });
      assert.deepEqual(await parseStoredJson(JSON.stringify(sealed)), { subject: "Hello", text: "Café" });

      const tampered = { ...sealed, authenticationTag: Buffer.alloc(16, 7).toString("base64") };
      await assert.rejects(() => openSealedValue(tampered), /could not be opened/);
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
