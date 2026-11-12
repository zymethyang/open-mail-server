import type { ConsoleDestination } from "../interfaces/consoleDestination.js";

export type ShellMode = "admin" | "mailbox";

const administratorDestinations: ConsoleDestination[] = [
  { href: "/admin/overview", label: "Overview", iconPath: "/icons/overview.svg" },
  { href: "/admin/logs", label: "Logs", iconPath: "/icons/logs.svg" },
  { href: "/admin/failed-email", label: "Failed email", iconPath: "/icons/failed.svg" },
  { href: "/admin/users", label: "User management", iconPath: "/icons/people.svg" },
  { href: "/admin/addresses", label: "Addresses", iconPath: "/icons/addresses.svg" },
  { href: "/admin/settings", label: "Settings", iconPath: "/icons/settings.svg" }
];

const overviewDestination: ConsoleDestination = { href: "/overview", label: "Overview", iconPath: "/icons/overview.svg" };

const mailboxDestination: ConsoleDestination = { href: "/mailbox", label: "My mailbox", iconPath: "/icons/mail.svg" };

const mailboxDestinations: ConsoleDestination[] = [overviewDestination, mailboxDestination];

const hashPathMap: Record<string, string> = {
  overview: "/admin/overview",
  attention: "/admin/attention",
  logs: "/admin/logs",
  "failed-email": "/admin/failed-email",
  users: "/admin/users",
  mailboxes: "/admin/users",
  addresses: "/admin/addresses",
  settings: "/admin/settings",
  mailbox: "/mailbox",
  account: "/account"
};

export function navigationEntries(role: string, shellMode: ShellMode): ConsoleDestination[] {
  if (role !== "administrator") {
    return [...mailboxDestinations];
  }
  if (shellMode === "admin") {
    return [...administratorDestinations];
  }
  return [...mailboxDestinations];
}

export function isAdminPath(pathName: string): boolean {
  return pathName === "/admin" || pathName.startsWith("/admin/");
}

export function isOverviewPath(pathName: string): boolean {
  return pathName === "/overview" || pathName.startsWith("/overview/");
}

export function isMailboxPath(pathName: string): boolean {
  return pathName === "/mailbox" || pathName.startsWith("/mailbox/");
}

export function isAccountPath(pathName: string): boolean {
  return pathName === "/account" || pathName.startsWith("/account/");
}

export function canOpenRoute(pathName: string, role: string): boolean {
  const normalized = normalizeConsolePath(pathName);
  if (isOverviewPath(normalized) || isMailboxPath(normalized) || isAccountPath(normalized)) {
    return true;
  }
  if (isAdminPath(normalized)) {
    return role === "administrator";
  }
  return false;
}

export function homePath(role: string): string {
  return role === "administrator" ? "/admin/overview" : "/mailbox";
}

export function shellModeForPath(pathName: string, role: string, previousMode: ShellMode): ShellMode {
  if (role !== "administrator") {
    return "mailbox";
  }
  const normalized = normalizeConsolePath(pathName);
  if (isAdminPath(normalized)) {
    return "admin";
  }
  if (isOverviewPath(normalized) || isMailboxPath(normalized)) {
    return "mailbox";
  }
  if (isAccountPath(normalized)) {
    return previousMode;
  }
  return previousMode;
}

export function normalizeConsolePath(pathName: string): string {
  if (!pathName || pathName === "/") {
    return "/";
  }
  const trimmed = pathName.replace(/\/+$/, "") || "/";
  if (trimmed === "/admin/mailboxes" || trimmed.startsWith("/admin/mailboxes/")) {
    return "/admin/users";
  }
  return trimmed;
}

export function mapHashToPath(hash: string): string | null {
  const raw = hash.replace(/^#/, "").trim();
  if (!raw) {
    return null;
  }
  const [name, ...rest] = raw.split("/");
  const base = hashPathMap[name || ""];
  if (!base) {
    return null;
  }
  if (name === "mailboxes") {
    return "/admin/users";
  }
  if (!rest.length) {
    return base;
  }
  if (name === "users") {
    return `/admin/users/${rest.join("/")}`;
  }
  if (name === "mailbox") {
    return `/mailbox/${rest.join("/")}`;
  }
  if (name === "overview" || name === "logs" || name === "failed-email" || name === "attention" || name === "settings" || name === "addresses") {
    return `${base}/${rest.join("/")}`;
  }
  return base;
}

export function routeKey(pathName: string): string {
  const normalized = normalizeConsolePath(pathName);
  if (normalized.startsWith("/admin/")) {
    return normalized.slice("/admin/".length);
  }
  if (normalized.startsWith("/")) {
    return normalized.slice(1);
  }
  return normalized;
}
