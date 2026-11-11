import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailboxEvents } from "../../../src/components/mailboxEvents/index.js";
import { MessageRepository } from "../../../src/components/message/index.js";
import type { MessageRepository as MessageRepositoryContract } from "../../../src/components/message/interfaces/messageRepository.js";
import { permanentFolders } from "../../../src/components/message/constants/permanentFolders.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { sampleMessage } from "../../support/sampleMessage.js";
import { statusCodeOf } from "../../support/statusCode.js";

describe("message repository interface", { concurrency: 1 }, () => {
  it("stores, updates, moves, and removes messages", async () => {
    const storageDirectory = await createTemporaryStorage();
    const events: string[] = [];
    const mailboxEvents = new MailboxEvents();
    const unsubscribe = mailboxEvents.subscribe((change) => {
      events.push(`${change.address}:${change.folderStorageName}`);
    });
    const repository: MessageRepositoryContract = new MessageRepository(storageDirectory, mailboxEvents);
    try {
      await repository.ensureMailbox("Ada@Acme.Test");
      const state = await repository.mailboxState("ada@acme.test");
      assert.deepEqual(
        state.folders.map((folder) => folder.storageName),
        permanentFolders.map((folder) => folder.storageName)
      );
      assert.equal(state.subscriptions.includes("inbox"), true);

      const first = await repository.appendMessage("ada@acme.test", "INBOX", sampleMessage({ subject: "First" }));
      const second = await repository.appendMessage("ada@acme.test", "inbox", sampleMessage({ subject: "Second", deleted: true }));
      assert.equal(first.uniqueIdentifier, 1);
      assert.equal(second.uniqueIdentifier, 2);
      assert.match(first.identifier, /^[a-f0-9]{24}$/);
      const listed = await repository.listMessages("ada@acme.test", "inbox");
      assert.deepEqual(
        listed.map((message) => message.subject),
        ["First", "Second"]
      );
      assert.equal(listed[0].rawEncoded, "");
      assert.equal(listed[0].text, "");
      assert.equal(listed[0].attachments.length, 0);
      assert.equal(listed[0].rawSize, first.rawSize);
      assert.equal(await repository.mailboxSize("ada@acme.test"), first.rawSize + second.rawSize);

      const updated = await repository.updateMessage("ada@acme.test", "inbox", first.identifier, {
        seen: true,
        subject: "Seen",
        rawEncoded: "changed"
      });
      assert.equal(updated.seen, true);
      assert.equal(updated.subject, "Seen");
      assert.equal(updated.identifier, first.identifier);
      assert.equal(updated.rawEncoded, "");
      const stored = await repository.readMessage("ada@acme.test", "inbox", first.identifier);
      assert.equal(stored.subject, "Seen");
      assert.equal(stored.rawEncoded, first.rawEncoded);

      const moved = await repository.moveMessage("ada@acme.test", "inbox", "trash", second.identifier);
      assert.equal(moved.folderName, "trash");
      assert.equal(moved.deleted, false);
      assert.equal(moved.uniqueIdentifier, 3);
      assert.equal((await repository.listMessages("ada@acme.test", "inbox")).length, 1);
      await repository.removeMessages("ada@acme.test", "trash", [moved.identifier, "not-an-identifier"]);
      assert.equal((await repository.listMessages("ada@acme.test", "trash")).length, 0);

      await assert.rejects(() => repository.readMessage("ada@acme.test", "inbox", "short"), (error: unknown) => statusCodeOf(error) === 404);
      await assert.rejects(
        () => repository.readMessage("ada@acme.test", "inbox", "a".repeat(24)),
        (error: unknown) => statusCodeOf(error) === 404
      );
      await assert.rejects(() => repository.listMessages("ada@acme.test", "missing"), (error: unknown) => statusCodeOf(error) === 404);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(events.includes("ada@acme.test:inbox"), true);
      assert.equal(events.includes("ada@acme.test:trash"), true);
      unsubscribe();
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("creates, renames, subscribes, and protects permanent folders", async () => {
    const storageDirectory = await createTemporaryStorage();
    const repository: MessageRepositoryContract = new MessageRepository(storageDirectory, new MailboxEvents());
    try {
      const created = await repository.createFolder("ada@acme.test", "Clients/Smith");
      assert.equal(created.storageName, "Clients%2FSmith");
      assert.equal(created.displayName, "Clients/Smith");
      const other = await repository.createFolder("ada@acme.test", "Clients-Smith");
      assert.equal(other.storageName, "Clients-Smith");
      assert.notEqual(created.storageName, other.storageName);
      await assert.rejects(() => repository.createFolder("ada@acme.test", "Clients/Smith"), (error: unknown) => statusCodeOf(error) === 400);
      await assert.rejects(() => repository.createFolder("ada@acme.test", " "), (error: unknown) => statusCodeOf(error) === 400);
      await assert.rejects(() => repository.deleteFolder("ada@acme.test", "INBOX"), (error: unknown) => statusCodeOf(error) === 400);
      await assert.rejects(() => repository.renameFolder("ada@acme.test", "INBOX", "Archive"), (error: unknown) => statusCodeOf(error) === 400);

      const renamed = await repository.renameFolder("ada@acme.test", "Clients/Smith", "Archive");
      assert.equal(renamed.storageName, "Archive");
      assert.equal(renamed.displayName, "Archive");
      await repository.setSubscription("ada@acme.test", "Archive", false);
      assert.equal((await repository.mailboxState("ada@acme.test")).subscriptions.includes("Archive"), false);
      await repository.setSubscription("ada@acme.test", "Archive", true);
      assert.equal((await repository.mailboxState("ada@acme.test")).subscriptions.includes("Archive"), true);
      await repository.deleteFolder("ada@acme.test", "Archive");
      assert.equal((await repository.listFolders("ada@acme.test")).some((folder) => folder.storageName === "Archive"), false);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
