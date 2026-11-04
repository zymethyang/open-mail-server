import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountRole } from "../../src/components/account/enums/accountRole.js";
import { ActivityAction } from "../../src/components/activity/enums/activityAction.js";
import { ActivityResult } from "../../src/components/activity/enums/activityResult.js";
import { MailProtocol } from "../../src/components/protocol/enums/mailProtocol.js";
import { PortReachabilityResult } from "../../src/components/publicPort/enums/portReachabilityResult.js";
import { RelaySecurity } from "../../src/components/settings/enums/relaySecurity.js";
import { contentTypes } from "../../src/components/web/constants/contentTypes.js";
import { permanentFolders } from "../../src/components/message/constants/permanentFolders.js";

describe("stored value interface", () => {
  it("keeps the values written to mail storage", () => {
    assert.equal(AccountRole.Administrator, "administrator");
    assert.equal(AccountRole.Member, "member");
    assert.equal(ActivityAction.Deliver, "deliver");
    assert.equal(ActivityAction.Reject, "reject");
    assert.equal(ActivityAction.SignIn, "sign-in");
    assert.equal(ActivityAction.Queue, "queue");
    assert.equal(ActivityAction.Account, "account");
    assert.equal(ActivityResult.Accepted, "accepted");
    assert.equal(ActivityResult.Rejected, "rejected");
    assert.equal(ActivityResult.Delivered, "delivered");
    assert.equal(ActivityResult.Queued, "queued");
    assert.equal(ActivityResult.Failed, "failed");
    assert.equal(MailProtocol.Smtp, "smtp");
    assert.equal(MailProtocol.Imap, "imap");
    assert.equal(MailProtocol.Pop3, "pop3");
    assert.equal(MailProtocol.Web, "web");
    assert.equal(RelaySecurity.StartTls, "starttls");
    assert.equal(RelaySecurity.Tls, "tls");
    assert.equal(RelaySecurity.Plain, "plain");
    assert.equal(PortReachabilityResult.Open, "Open");
    assert.equal(PortReachabilityResult.Closed, "Closed");
    assert.equal(PortReachabilityResult.Unknown, "Unknown");
    assert.deepEqual(
      permanentFolders.map((folder) => folder.storageName),
      ["inbox", "sent", "drafts", "trash"]
    );
    assert.equal(contentTypes[".html"], "text/html; charset=utf-8");
    assert.equal(contentTypes[".css"], "text/css; charset=utf-8");
    assert.equal(contentTypes[".js"], "text/javascript; charset=utf-8");
  });
});
