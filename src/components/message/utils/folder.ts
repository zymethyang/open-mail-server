import type { MailFolder } from "../interfaces/mailTypes.js";

export const maximumFolderNameLength = 200;

export function storageNameFromDisplay(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed || trimmed.length > maximumFolderNameLength || trimmed.includes("\0") || trimmed === "." || trimmed === "..") {
    return "";
  }
  return encodeURIComponent(trimmed);
}

export function findFolder(folders: MailFolder[], name: unknown): MailFolder | null {
  const cleaned = String(name ?? "")
    .replace(/^"|"$/g, "")
    .trim();
  if (!cleaned) {
    return null;
  }
  if (cleaned.toLowerCase() === "inbox") {
    return folders.find((folder) => folder.storageName === "inbox" || folder.specialUse === "\\Inbox") || null;
  }
  const encoded = storageNameFromDisplay(cleaned);
  return (
    folders.find((folder) => folder.displayName === cleaned || folder.storageName === cleaned || (encoded !== "" && folder.storageName === encoded)) ||
    null
  );
}

export function isSafeStorageName(storageName: string): boolean {
  if (!storageName || storageName.length > 600 || storageName === "." || storageName === "..") {
    return false;
  }
  if (storageName.includes("/") || storageName.includes("\\") || storageName.includes("\0")) {
    return false;
  }
  return /^[A-Za-z0-9._~%!-]+$/.test(storageName);
}
