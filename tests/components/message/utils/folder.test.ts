import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { permanentFolders } from "../../../../src/components/message/constants/permanentFolders.js";
import { findFolder, isSafeStorageName, storageNameFromDisplay } from "../../../../src/components/message/utils/folder.js";

describe("folder logic", () => {
  it("turns a display name into a safe storage name", () => {
    assert.equal(storageNameFromDisplay("  Hello, World! "), "hello-world");
    assert.equal(storageNameFromDisplay("!!!"), "");
    assert.equal(storageNameFromDisplay("a".repeat(80)).length, 40);
  });

  it("finds a folder by storage name, display name, or quoted display name", () => {
    const inbox = findFolder(permanentFolders, '"INBOX"');
    assert.equal(inbox?.storageName, "inbox");
    assert.equal(findFolder(permanentFolders, "Sent")?.specialUse, "\\Sent");
    assert.equal(findFolder(permanentFolders, "missing"), null);
    assert.equal(findFolder(permanentFolders, null), null);
  });

  it("accepts only lowercase storage names", () => {
    assert.equal(isSafeStorageName("inbox"), true);
    assert.equal(isSafeStorageName("project-files"), true);
    assert.equal(isSafeStorageName("Inbox"), false);
    assert.equal(isSafeStorageName("-inbox"), false);
    assert.equal(isSafeStorageName("in_box"), false);
    assert.equal(isSafeStorageName(""), false);
  });
});
