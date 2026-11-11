import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const backupDirectoryName = "backups";

function backupRoot(storageDirectory: string): string {
  return path.join(storageDirectory, backupDirectoryName);
}

export async function createStorageBackup(storageDirectory: string, createdAt = new Date()): Promise<string> {
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-");
  const destination = path.join(backupRoot(storageDirectory), stamp);
  await mkdir(destination, { recursive: true });
  const names = await readdir(storageDirectory);
  for (const name of names) {
    if (name === backupDirectoryName) {
      continue;
    }
    await cp(path.join(storageDirectory, name), path.join(destination, name), { recursive: true });
  }
  return destination;
}

export async function restoreStorageBackup(storageDirectory: string, backupDirectory: string): Promise<void> {
  const resolvedRoot = path.resolve(backupRoot(storageDirectory));
  const resolvedBackup = path.resolve(backupDirectory);
  if (resolvedBackup !== resolvedRoot && !resolvedBackup.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("The backup is not in the storage backup directory");
  }
  const names = await readdir(backupDirectory);
  const currentNames = await readdir(storageDirectory);
  for (const name of currentNames) {
    if (name === backupDirectoryName) {
      continue;
    }
    await rm(path.join(storageDirectory, name), { recursive: true, force: true });
  }
  for (const name of names) {
    if (name === backupDirectoryName) {
      continue;
    }
    await cp(path.join(backupDirectory, name), path.join(storageDirectory, name), { recursive: true });
  }
}

export async function listStorageBackups(storageDirectory: string): Promise<string[]> {
  try {
    const names = await readdir(backupRoot(storageDirectory));
    return names.sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
