import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailboxEvents } from "../../../src/components/mailboxEvents/index.js";
import type { MailboxEvents as MailboxEventsContract } from "../../../src/components/mailboxEvents/interfaces/mailboxEvents.js";

describe("mailbox events interface", () => {
  it("delivers a change to current subscribers only", async () => {
    const events: MailboxEventsContract = new MailboxEvents();
    const received: string[] = [];
    const unsubscribe = events.subscribe((change) => {
      received.push(change.folderStorageName);
    });
    events.subscribe((change) => {
      received.push(`second:${change.address}`);
    });
    events.publish({ address: "ada@acme.test", folderStorageName: "inbox" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(received, ["inbox", "second:ada@acme.test"]);
    unsubscribe();
    events.publish({ address: "ada@acme.test", folderStorageName: "sent" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(received, ["inbox", "second:ada@acme.test", "second:ada@acme.test"]);
  });
});
