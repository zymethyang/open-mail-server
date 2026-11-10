import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  maximumSealedBytes,
  storageAssociatedDataPrefix,
  storageAuthenticationTagBytes,
  storageCipherAlgorithm,
  storageFormatVersion,
  storageKeyBytes,
  storageKeyDerivationHash,
  storageKeyDerivationInfo,
  storageKeyDerivationSalt,
  storageNonceBytes
} from "./constants/storageCipher.js";
import type { SealedEnvelope } from "./interfaces/sealedEnvelope.js";
import type { LoadedStorageKey } from "./interfaces/loadedStorageKey.js";
export type { SealedEnvelope };

let storageKey: Promise<LoadedStorageKey> | null = null;

export async function openSecureStorage(storageDirectory: string): Promise<void> {
  storageKey = loadStorageKey(storageDirectory);
  await storageKey;
  await mkdir(storageDirectory, { recursive: true });
  await chmod(storageDirectory, 0o700).catch(() => undefined);
}

export function storageIsReady(): boolean {
  return storageKey !== null;
}

export async function sealValue(value: unknown, purpose = ""): Promise<SealedEnvelope> {
  const loaded = await requireStorageKey();
  const nonce = randomBytes(storageNonceBytes);
  const cipher = createCipheriv(storageCipherAlgorithm, loaded.derived, nonce, { authTagLength: storageAuthenticationTagBytes });
  cipher.setAAD(associatedData(purpose));
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), "utf8")), cipher.final()]);
  return {
    sealed: true,
    version: storageFormatVersion,
    nonce: nonce.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64")
  };
}

export async function openSealedValue<T>(envelope: SealedEnvelope, purpose = ""): Promise<T> {
  if (envelope.version === undefined) {
    return openOriginalEnvelope<T>(envelope);
  }
  if (envelope.version !== storageFormatVersion) {
    throw new Error("Stored data is not supported");
  }
  return openCurrentEnvelope<T>(envelope, purpose);
}

export function isSealedEnvelope(value: unknown): value is SealedEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<SealedEnvelope>;
  if (record.sealed !== true || typeof record.nonce !== "string" || typeof record.ciphertext !== "string") {
    return false;
  }
  if (record.version !== undefined && typeof record.version !== "number") {
    return false;
  }
  if (record.authenticationTag !== undefined && typeof record.authenticationTag !== "string") {
    return false;
  }
  return true;
}

async function openCurrentEnvelope<T>(envelope: SealedEnvelope, purpose: string): Promise<T> {
  const loaded = await requireStorageKey();
  const nonce = decodeStoredBytes(envelope.nonce, storageNonceBytes);
  const ciphertext = decodeStoredBytes(envelope.ciphertext, 0);
  const authenticationTag = decodeStoredBytes(envelope.authenticationTag || "", storageAuthenticationTagBytes);
  if (!ciphertext.length) {
    throw new Error("Stored data is incomplete");
  }
  const decipher = createDecipheriv(storageCipherAlgorithm, loaded.derived, nonce, { authTagLength: storageAuthenticationTagBytes });
  decipher.setAAD(associatedData(purpose));
  decipher.setAuthTag(authenticationTag);
  return parsePlaintext<T>(decrypt(decipher, ciphertext));
}

async function openOriginalEnvelope<T>(envelope: SealedEnvelope): Promise<T> {
  const loaded = await requireStorageKey();
  const nonce = decodeStoredBytes(envelope.nonce, storageNonceBytes);
  const combined = decodeStoredBytes(envelope.ciphertext, 0);
  if (combined.length <= storageAuthenticationTagBytes) {
    throw new Error("Stored data is incomplete");
  }
  const authenticationTag = combined.subarray(combined.length - storageAuthenticationTagBytes);
  const ciphertext = combined.subarray(0, combined.length - storageAuthenticationTagBytes);
  const decipher = createDecipheriv(storageCipherAlgorithm, loaded.master, nonce, { authTagLength: storageAuthenticationTagBytes });
  decipher.setAuthTag(authenticationTag);
  return parsePlaintext<T>(decrypt(decipher, ciphertext));
}

function decrypt(decipher: ReturnType<typeof createDecipheriv>, ciphertext: Buffer): Buffer {
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Stored data could not be opened");
  }
}

function parsePlaintext<T>(plaintext: Buffer): T {
  try {
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    throw new Error("Stored data could not be opened");
  }
}

function associatedData(purpose: string): Buffer {
  if (purpose.length > 200) {
    throw new Error("Stored data purpose is too long");
  }
  return Buffer.from(`${storageAssociatedDataPrefix}\0${purpose}`, "utf8");
}

function decodeStoredBytes(value: string, expectedLength: number): Buffer {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Stored data is incomplete");
  }
  const decoded = Buffer.from(value, "base64");
  if ((expectedLength > 0 && decoded.length !== expectedLength) || decoded.length > maximumSealedBytes) {
    throw new Error(decoded.length > maximumSealedBytes ? "Stored data is too large" : "Stored data is incomplete");
  }
  return decoded;
}

function deriveStorageKey(master: Buffer): Buffer {
  return Buffer.from(
    hkdfSync(
      storageKeyDerivationHash,
      master,
      Buffer.from(storageKeyDerivationSalt),
      Buffer.from(storageKeyDerivationInfo),
      storageKeyBytes
    )
  );
}

async function requireStorageKey(): Promise<LoadedStorageKey> {
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

async function loadStorageKey(storageDirectory: string): Promise<LoadedStorageKey> {
  const keyPath = path.join(storageDirectory, "storage-key");
  try {
    const existing = await readFile(keyPath);
    if (existing.length !== storageKeyBytes) {
      throw new Error("The storage key file must be 32 bytes");
    }
    await chmod(keyPath, 0o600).catch(() => undefined);
    return { master: existing, derived: deriveStorageKey(existing) };
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
  return { master: created, derived: deriveStorageKey(created) };
}
