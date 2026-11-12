export enum ApiEndpoint {
  Root = "/api",
  Bootstrap = "/api/bootstrap",
  Setup = "/api/setup",
  Session = "/api/session",
  SessionOneTimePassword = "/api/session/one-time-password",
  Activity = "/api/admin/activity",
  ActivitySummary = "/api/admin/activity/summary",
  ActivityAttention = "/api/admin/activity/attention",
  ActivityAttentionReset = "/api/admin/activity/attention/reset",
  FailedEmail = "/api/admin/failed-email",
  FailedEmailResend = "/api/admin/failed-email/resend",
  Mailboxes = "/api/admin/mailboxes",
  AddressRoutes = "/api/admin/address-routes",
  AddressRouteAliases = "/api/admin/address-routes/aliases",
  AddressRouteLists = "/api/admin/address-routes/lists",
  AddressRouteDomains = "/api/admin/address-routes/domains",
  AddressRouteCatchAll = "/api/admin/address-routes/catch-all",
  AddressRouteBlocked = "/api/admin/address-routes/blocked",
  Backup = "/api/admin/backup",
  BackupRestore = "/api/admin/backup/restore",
  MailboxPassword = "/api/admin/mailboxes/password",
  MailboxAccess = "/api/admin/mailboxes/access",
  Settings = "/api/admin/settings",
  Certificate = "/api/admin/certificate",
  MailClientSettings = "/api/mail-client-settings",
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

export function folderMessagesPath(folderName: string, search = ""): string {
  const pathName = ApiEndpoint.FolderMessages.replace(":folder", encodeURIComponent(folderName));
  const query = search.trim();
  return query ? `${pathName}?search=${encodeURIComponent(query)}` : pathName;
}

export function folderMessagePath(folderName: string, identifier: string): string {
  return ApiEndpoint.FolderMessage.replace(":folder", encodeURIComponent(folderName)).replace(":message", encodeURIComponent(identifier));
}

export function folderAttachmentPath(folderName: string, identifier: string, attachmentIndex: number): string {
  return ApiEndpoint.FolderAttachment.replace(":folder", encodeURIComponent(folderName))
    .replace(":message", encodeURIComponent(identifier))
    .replace(":attachment", String(attachmentIndex));
}
