import { cp, lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const backupDirectoryName = "backups";
const backupStampPattern = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

let restoreInProgress = false;

function backupRoot(storageDirectory: string): string {
  return path.join(storageDirectory, backupDirectoryName);
}

export function parseBackupStamp(backupName: string): Date | null {
  const match = backupStampPattern.exec(backupName);
  if (!match) {
    return null;
  }
  const parsed = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

export function isRestoreInProgress(): boolean {
  return restoreInProgress;
}

export function tryBeginRestore(): boolean {
  if (restoreInProgress) {
    return false;
  }
  restoreInProgress = true;
  return true;
}

export function endRestore(): void {
  restoreInProgress = false;
}

export function resolveBackupDirectory(storageDirectory: string, backupName: string): string {
  if (!backupName || !parseBackupStamp(backupName)) {
    throw new Error("Choose a backup from the list");
  }
  if (
    backupName !== path.basename(backupName) ||
    backupName.includes("/") ||
    backupName.includes("\\") ||
    backupName.includes("\0") ||
    backupName === "." ||
    backupName === ".."
  ) {
    throw new Error("Choose a backup from the list");
  }
  const resolvedRoot = path.resolve(backupRoot(storageDirectory));
  const resolvedBackup = path.resolve(resolvedRoot, backupName);
  if (resolvedBackup === resolvedRoot || !resolvedBackup.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Choose a backup from the list");
  }
  return resolvedBackup;
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

async function requireBackupDirectory(storageDirectory: string, backupName: string): Promise<string> {
  const backupDirectory = resolveBackupDirectory(storageDirectory, backupName);
  const entry = await lstat(backupDirectory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    const notFound = new Error("That backup was not found") as NodeJS.ErrnoException;
    notFound.code = "ENOENT";
    throw notFound;
  }
  return backupDirectory;
}

export async function restoreStorageBackup(storageDirectory: string, backupName: string): Promise<void> {
  const backupDirectory = await requireBackupDirectory(storageDirectory, backupName);
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

export async function deleteStorageBackup(storageDirectory: string, backupName: string): Promise<void> {
  const backupDirectory = await requireBackupDirectory(storageDirectory, backupName);
  await rm(backupDirectory, { recursive: true, force: false });
}

export async function listStorageBackups(storageDirectory: string): Promise<string[]> {
  try {
    const entries = await readdir(backupRoot(storageDirectory), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && parseBackupStamp(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
