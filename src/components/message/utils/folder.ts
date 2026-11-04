import type { MailFolder } from "../interfaces/mailTypes.js";

export function storageNameFromDisplay(displayName: string): string {
  return displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function findFolder(folders: MailFolder[], name: unknown): MailFolder | null {
  const lowered = String(name ?? "")
    .replace(/^"|"$/g, "")
    .trim()
    .toLowerCase();
  return (
    folders.find((folder) => folder.storageName === lowered || folder.displayName.toLowerCase() === lowered) || null
  );
}

export function isSafeStorageName(storageName: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storageName);
}
