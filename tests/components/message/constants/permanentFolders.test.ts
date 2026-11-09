import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { permanentFolders } from "../../../../src/components/message/constants/permanentFolders.js";
import { MailFolderName } from "../../../../src/components/message/enums/mailFolderName.js";

describe("permanent folders", () => {
  it("keeps the values written to mail storage", () => {
    assert.deepEqual(Object.values(MailFolderName), ["inbox", "sent", "drafts", "trash", "junk"]);
    assert.deepEqual(
      permanentFolders.map((folder) => folder.storageName),
      [MailFolderName.Inbox, MailFolderName.Sent, MailFolderName.Drafts, MailFolderName.Trash, MailFolderName.Junk]
    );
  });
});
