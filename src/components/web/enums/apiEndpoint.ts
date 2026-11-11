export enum ApiEndpoint {
  Root = "/api",
  Bootstrap = "/api/bootstrap",
  Setup = "/api/setup",
  Session = "/api/session",
  SessionOneTimePassword = "/api/session/one-time-password",
  Activity = "/api/activity",
  ActivitySummary = "/api/activity/summary",
  ActivityAttention = "/api/activity/attention",
  ActivityAttentionReset = "/api/activity/attention/reset",
  FailedEmail = "/api/failed-email",
  FailedEmailResend = "/api/failed-email/resend",
  Mailboxes = "/api/mailboxes",
  AddressRoutes = "/api/address-routes",
  AddressRouteAliases = "/api/address-routes/aliases",
  AddressRouteLists = "/api/address-routes/lists",
  AddressRouteDomains = "/api/address-routes/domains",
  AddressRouteCatchAll = "/api/address-routes/catch-all",
  AddressRouteBlocked = "/api/address-routes/blocked",
  Backup = "/api/backup",
  MailboxPassword = "/api/mailboxes/password",
  MailboxAccess = "/api/mailboxes/access",
  Settings = "/api/settings",
  Certificate = "/api/certificate",
  AccountPassword = "/api/account/password",
  MailboxEvents = "/api/mailbox-events",
  AccountOneTimePassword = "/api/account/one-time-password",
  AccountOneTimePasswordConfirm = "/api/account/one-time-password/confirm",
  AccountOneTimePasswordRemove = "/api/account/one-time-password/remove",
  Folders = "/api/folders",
  FolderMessages = "/api/folders/:folder/messages",
  FolderMessage = "/api/folders/:folder/messages/:message",
  FolderAttachment = "/api/folders/:folder/messages/:message/attachments/:attachment",
  Messages = "/api/messages",
  Drafts = "/api/drafts"
}

export function matchApiEndpoint(pathName: string, endpoint: ApiEndpoint): Record<string, string> | null {
  const names: string[] = [];
  const pattern = endpoint.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    names.push(name);
    return name === "attachment" ? "(\\d+)" : "([^/]+)";
  });
  if (!names.length) {
    return pathName === endpoint ? {} : null;
  }
  const matched = new RegExp(`^${pattern}$`).exec(pathName);
  if (!matched) {
    return null;
  }
  const parameters: Record<string, string> = {};
  names.forEach((name, index) => {
    parameters[name] = decodeURIComponent(matched[index + 1] || "");
  });
  return parameters;
}
