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
