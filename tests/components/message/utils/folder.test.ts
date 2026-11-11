import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { permanentFolders } from "../../../../src/components/message/constants/permanentFolders.js";
import { findFolder, isSafeStorageName, storageNameFromDisplay } from "../../../../src/components/message/utils/folder.js";

describe("folder logic", () => {
  it("keeps the folder name as its identity", () => {
    assert.equal(storageNameFromDisplay("Clients/Smith"), "Clients%2FSmith");
    assert.equal(storageNameFromDisplay("Clients-Smith"), "Clients-Smith");
    assert.notEqual(storageNameFromDisplay("Clients/Smith"), storageNameFromDisplay("Clients-Smith"));
    assert.equal(storageNameFromDisplay("  Hello, World! "), "Hello%2C%20World!");
    assert.equal(storageNameFromDisplay(""), "");
    assert.equal(storageNameFromDisplay("."), "");
    assert.equal(storageNameFromDisplay("a".repeat(201)), "");
    assert.equal(storageNameFromDisplay("a".repeat(80)).length, 80);
  });

  it("finds a folder by its exact name and treats inbox without case", () => {
    const inbox = findFolder(permanentFolders, '"INBOX"');
    assert.equal(inbox?.storageName, "inbox");
    assert.equal(findFolder(permanentFolders, "inbox")?.storageName, "inbox");
    assert.equal(findFolder(permanentFolders, "Sent")?.specialUse, "\\Sent");
    assert.equal(findFolder(permanentFolders, "missing"), null);
    assert.equal(findFolder(permanentFolders, null), null);
    const custom = [
      ...permanentFolders,
      { storageName: "Clients%2FSmith", displayName: "Clients/Smith", label: "Clients/Smith", permanent: false, specialUse: "" },
      { storageName: "Clients-Smith", displayName: "Clients-Smith", label: "Clients-Smith", permanent: false, specialUse: "" }
    ];
    assert.equal(findFolder(custom, "Clients/Smith")?.storageName, "Clients%2FSmith");
    assert.equal(findFolder(custom, "Clients-Smith")?.storageName, "Clients-Smith");
  });

  it("accepts an encoded storage name and rejects a path", () => {
    assert.equal(isSafeStorageName("inbox"), true);
    assert.equal(isSafeStorageName("Clients%2FSmith"), true);
    assert.equal(isSafeStorageName("Clients-Smith"), true);
    assert.equal(isSafeStorageName("Clients/Smith"), false);
    assert.equal(isSafeStorageName(".."), false);
    assert.equal(isSafeStorageName(""), false);
  });
});
