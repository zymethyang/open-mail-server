import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openSecureStorage } from "../../src/components/secureStorage/index.js";

export const testStorageKey = Buffer.alloc(32, 11);

export async function createTemporaryStorage(): Promise<string> {
  const storageDirectory = await mkdtemp(path.join(os.tmpdir(), "email-server-test-"));
  await mkdir(storageDirectory, { recursive: true });
  await writeFile(path.join(storageDirectory, "storage-key"), testStorageKey, { mode: 0o600 });
  await openSecureStorage(storageDirectory);
  return storageDirectory;
}

export async function removeTemporaryStorage(storageDirectory: string): Promise<void> {
  await rm(storageDirectory, { recursive: true, force: true });
}
