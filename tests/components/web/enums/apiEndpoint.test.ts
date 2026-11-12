import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiEndpoint, matchApiEndpoint } from "../../../../src/components/web/enums/apiEndpoint.js";

describe("api endpoints", () => {
  it("keeps the paths the web console calls", () => {
    assert.equal(ApiEndpoint.Bootstrap, "/api/bootstrap");
    assert.equal(ApiEndpoint.Setup, "/api/setup");
    assert.equal(ApiEndpoint.Session, "/api/session");
    assert.equal(ApiEndpoint.SessionOneTimePassword, "/api/session/one-time-password");
    assert.equal(ApiEndpoint.Activity, "/api/admin/activity");
    assert.equal(ApiEndpoint.ActivitySummary, "/api/admin/activity/summary");
    assert.equal(ApiEndpoint.ActivityAttention, "/api/admin/activity/attention");
    assert.equal(ApiEndpoint.ActivityAttentionReset, "/api/admin/activity/attention/reset");
    assert.equal(ApiEndpoint.FailedEmail, "/api/admin/failed-email");
    assert.equal(ApiEndpoint.FailedEmailResend, "/api/admin/failed-email/resend");
    assert.equal(ApiEndpoint.Mailboxes, "/api/admin/mailboxes");
    assert.equal(ApiEndpoint.MailboxPassword, "/api/admin/mailboxes/password");
    assert.equal(ApiEndpoint.MailboxAccess, "/api/admin/mailboxes/access");
    assert.equal(ApiEndpoint.Settings, "/api/admin/settings");
    assert.equal(ApiEndpoint.Certificate, "/api/admin/certificate");
    assert.equal(ApiEndpoint.Backup, "/api/admin/backup");
    assert.equal(ApiEndpoint.BackupRestore, "/api/admin/backup/restore");
    assert.equal(ApiEndpoint.MailClientSettings, "/api/mail-client-settings");
    assert.equal(ApiEndpoint.AccountPassword, "/api/account/password");
    assert.equal(ApiEndpoint.MailboxEvents, "/api/mailbox-events");
    assert.equal(ApiEndpoint.AccountOneTimePassword, "/api/account/one-time-password");
    assert.equal(ApiEndpoint.AccountOneTimePasswordConfirm, "/api/account/one-time-password/confirm");
    assert.equal(ApiEndpoint.AccountOneTimePasswordRemove, "/api/account/one-time-password/remove");
    assert.equal(ApiEndpoint.Folders, "/api/folders");
    assert.equal(ApiEndpoint.Messages, "/api/messages");
    assert.equal(ApiEndpoint.Drafts, "/api/drafts");
  });

  it("reads a folder, a message, and an attachment from the path", () => {
    assert.deepEqual(matchApiEndpoint("/api/folders/inbox/messages", ApiEndpoint.FolderMessages), { folder: "inbox" });
    assert.deepEqual(matchApiEndpoint("/api/folders/Sent/messages/abc", ApiEndpoint.FolderMessage), { folder: "Sent", message: "abc" });
    assert.deepEqual(matchApiEndpoint("/api/folders/inbox/messages/abc/attachments/2", ApiEndpoint.FolderAttachment), {
      folder: "inbox",
      message: "abc",
      attachment: "2"
    });
    assert.equal(matchApiEndpoint("/api/folders/inbox/messages/abc/attachments/nope", ApiEndpoint.FolderAttachment), null);
    assert.equal(matchApiEndpoint("/api/folders/inbox", ApiEndpoint.FolderMessages), null);
    assert.deepEqual(matchApiEndpoint(ApiEndpoint.Messages, ApiEndpoint.Messages), {});
  });
});
