import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { storageCipherAlgorithm, storageKeyBytes } from "./constants/storageCipher.js";
import type { SealedEnvelope } from "./interfaces/sealedEnvelope.js";
export type { SealedEnvelope };

let storageKey: Promise<Buffer> | null = null;

export async function openSecureStorage(storageDirectory: string): Promise<void> {
  storageKey = loadStorageKey(storageDirectory);
  await storageKey;
  await mkdir(storageDirectory, { recursive: true });
  await chmod(storageDirectory, 0o700).catch(() => undefined);
}

export function storageIsReady(): boolean {
  return storageKey !== null;
}

export async function sealValue(value: unknown): Promise<SealedEnvelope> {
  const key = await requireStorageKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv(storageCipherAlgorithm, key, nonce);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    sealed: true,
    nonce: nonce.toString("base64"),
    ciphertext: Buffer.concat([encrypted, tag]).toString("base64")
  };
}

export async function openSealedValue<T>(envelope: SealedEnvelope): Promise<T> {
  const key = await requireStorageKey();
  const nonce = Buffer.from(envelope.nonce, "base64");
  const combined = Buffer.from(envelope.ciphertext, "base64");
  if (combined.length < 16) {
    throw new Error("Stored data is incomplete");
  }
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(0, combined.length - 16);
  const decipher = createDecipheriv(storageCipherAlgorithm, key, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function isSealedEnvelope(value: unknown): value is SealedEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<SealedEnvelope>;
  return record.sealed === true && typeof record.nonce === "string" && typeof record.ciphertext === "string";
}

async function requireStorageKey(): Promise<Buffer> {
  if (!storageKey) {
    throw new Error("Secure storage is not ready");
  }
  return storageKey;
}

async function storageHasSealedData(storageDirectory: string): Promise<boolean> {
  const names = ["accounts.json", "organization.json", "settings.json", "sessions.json"];
  for (const name of names) {
    try {
      const content = await readFile(path.join(storageDirectory, name), "utf8");
      if (content.includes("\"sealed\":true") || content.includes("\"sealed\": true")) {
        return true;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return false;
}

async function loadStorageKey(storageDirectory: string): Promise<Buffer> {
  const keyPath = path.join(storageDirectory, "storage-key");
  try {
    const existing = await readFile(keyPath);
    if (existing.length !== storageKeyBytes) {
      throw new Error("The storage key file must be 32 bytes");
    }
    await chmod(keyPath, 0o600).catch(() => undefined);
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  if (await storageHasSealedData(storageDirectory)) {
    throw new Error("The storage key file is missing. Place the existing 32-byte key at storage-key in the storage directory before starting.");
  }
  const created = randomBytes(storageKeyBytes);
  await mkdir(storageDirectory, { recursive: true });
  await writeFile(keyPath, created, { mode: 0o600 });
  await chmod(keyPath, 0o600).catch(() => undefined);
  return created;
}
