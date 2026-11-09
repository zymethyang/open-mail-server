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

      const updated = await repository.updateMessage("ada@acme.test", "inbox", first.identifier, {
        seen: true,
        subject: "Seen",
        rawEncoded: "changed"
      });
      assert.equal(updated.seen, true);
      assert.equal(updated.subject, "Seen");
      assert.equal(updated.identifier, first.identifier);
      assert.equal(updated.rawEncoded, first.rawEncoded);
      assert.equal((await repository.readMessage("ada@acme.test", "inbox", first.identifier)).subject, "Seen");

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
      const created = await repository.createFolder("ada@acme.test", "Project Files");
      assert.equal(created.storageName, "project-files");
      assert.equal(created.permanent, false);
      await assert.rejects(() => repository.createFolder("ada@acme.test", "Project Files"), (error: unknown) => statusCodeOf(error) === 400);
      await assert.rejects(() => repository.createFolder("ada@acme.test", "!!!"), (error: unknown) => statusCodeOf(error) === 400);
      await assert.rejects(() => repository.deleteFolder("ada@acme.test", "INBOX"), (error: unknown) => statusCodeOf(error) === 400);
      await assert.rejects(() => repository.renameFolder("ada@acme.test", "INBOX", "Archive"), (error: unknown) => statusCodeOf(error) === 400);

      const renamed = await repository.renameFolder("ada@acme.test", "Project Files", "Archive");
      assert.equal(renamed.storageName, "archive");
      assert.equal(renamed.displayName, "Archive");
      await repository.setSubscription("ada@acme.test", "Archive", false);
      assert.equal((await repository.mailboxState("ada@acme.test")).subscriptions.includes("archive"), false);
      await repository.setSubscription("ada@acme.test", "archive", true);
      assert.equal((await repository.mailboxState("ada@acme.test")).subscriptions.includes("archive"), true);
      await repository.deleteFolder("ada@acme.test", "Archive");
      assert.equal((await repository.listFolders("ada@acme.test")).some((folder) => folder.storageName === "archive"), false);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
