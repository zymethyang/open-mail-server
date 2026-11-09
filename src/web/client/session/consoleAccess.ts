export interface ConsoleDestination {
  href: string;
  label: string;
  iconPath: string;
}

const administratorDestinations: ConsoleDestination[] = [
  { href: "#overview", label: "Overview", iconPath: "icons/overview.svg" },
  { href: "#logs", label: "Logs", iconPath: "icons/logs.svg" },
  { href: "#failed-email", label: "Failed email", iconPath: "icons/failed.svg" },
  { href: "#users", label: "User management", iconPath: "icons/people.svg" },
  { href: "#settings", label: "Settings", iconPath: "icons/settings.svg" }
];

const mailboxDestination: ConsoleDestination = { href: "#mailbox", label: "My mailbox", iconPath: "icons/mail.svg" };

const administratorRouteNames = new Set(["overview", "attention", "logs", "failed-email", "users", "mailboxes", "settings"]);

export function navigationEntries(role: string): ConsoleDestination[] {
  if (role === "administrator") {
    return [...administratorDestinations, mailboxDestination];
  }
  return [mailboxDestination];
}

export function canOpenRoute(route: string, role: string): boolean {
  const name = route.split(/[/?#]/)[0] || "";
  if (name === "mailbox" || name === "account") {
    return true;
  }
  return role === "administrator" && administratorRouteNames.has(name);
}

export function homeHash(role: string): string {
  return role === "administrator" ? "#overview" : "#mailbox";
}
