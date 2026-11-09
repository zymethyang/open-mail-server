import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ActivityAction } from "../../../src/components/activity/enums/activityAction.js";
import { ActivityResult } from "../../../src/components/activity/enums/activityResult.js";
import { ActivityLogger } from "../../../src/components/activity/index.js";
import type { ActivityLogger as ActivityLoggerContract } from "../../../src/components/activity/interfaces/activityLogger.js";
import { MailProtocol } from "../../../src/components/protocol/enums/mailProtocol.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";

describe("activity logger interface", () => {
  it("filters events and counts each day", async () => {
    const storageDirectory = await createTemporaryStorage();
    const logger: ActivityLoggerContract = new ActivityLogger(storageDirectory);
    try {
      assert.deepEqual(await logger.query({ protocol: "", result: "", search: "", limit: 10 }), []);
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await logger.record({
        occurredAt: yesterday,
        protocol: MailProtocol.Smtp,
        action: ActivityAction.Deliver,
        remoteAddress: "127.0.0.1",
        mailboxAddress: "ada@acme.test",
        senderAddress: "ada@acme.test",
        recipientAddresses: ["person@example.test"],
        subject: "Yesterday",
        byteCount: 10,
        result: ActivityResult.Accepted,
        detail: "relayed"
      });
      await logger.record({
        protocol: MailProtocol.Smtp,
        action: ActivityAction.Deliver,
        remoteAddress: "",
        mailboxAddress: "bea@acme.test",
        senderAddress: "outside@example.test",
        recipientAddresses: ["bea@acme.test"],
        subject: "Protocol check",
        byteCount: 20,
        result: ActivityResult.Delivered,
        detail: "sent"
      });
      await logger.record({
        protocol: MailProtocol.Smtp,
        action: ActivityAction.Deliver,
        remoteAddress: "203.0.113.10",
        mailboxAddress: "ada@acme.test",
        senderAddress: "person@example.test",
        recipientAddresses: ["ada@acme.test"],
        subject: "Incoming",
        byteCount: 30,
        result: ActivityResult.Delivered,
        detail: "stored"
      });
      await logger.record({
        protocol: MailProtocol.Web,
        action: ActivityAction.SignIn,
        remoteAddress: "",
        mailboxAddress: "ada@acme.test",
        senderAddress: "",
        recipientAddresses: [],
        subject: "",
        byteCount: 0,
        result: ActivityResult.Rejected,
        detail: "invalid credentials"
      });
      await logger.record({
        protocol: MailProtocol.Smtp,
        action: ActivityAction.Queue,
        remoteAddress: "",
        mailboxAddress: "",
        senderAddress: "ada@acme.test",
        recipientAddresses: ["person@example.test"],
        subject: "Queued",
        byteCount: 5,
        result: ActivityResult.Failed,
        detail: "down"
      });

      const protocol = await logger.query({ protocol: MailProtocol.Web, result: "", search: "", limit: 10 });
      assert.equal(protocol.length, 1);
      assert.equal(protocol[0].result, ActivityResult.Rejected);
      const search = await logger.query({ protocol: "", result: "", search: "PROTOCOL", limit: 10 });
      assert.equal(search.length, 1);
      assert.equal(search[0].subject, "Protocol check");
      const limited = await logger.query({ protocol: "", result: "", search: "", limit: 2 });
      assert.equal(limited.length, 2);
      assert.equal(typeof limited[0].identifier, "string");

      const days = await logger.dailyCounts(2);
      assert.equal(days.length, 2);
      const today = days[1];
      assert.equal(today.delivered, 2);
      assert.equal(today.sent, 1);
      assert.equal(today.incoming, 1);
      assert.equal(today.outgoing, 1);
      assert.equal(today.rejected, 1);
      assert.equal(today.failed, 1);
      assert.equal(days[0].sent, 1);
      assert.equal(days[0].incoming, 0);
      assert.equal(days[0].outgoing, 1);

      const attention = await logger.attentionEvents();
      assert.equal(attention.length, 2);
      assert.equal(attention.some((event) => event.result === ActivityResult.Rejected), true);
      assert.equal(attention.some((event) => event.result === ActivityResult.Failed), true);
      await logger.acknowledgeAttention();
      assert.deepEqual(await logger.attentionEvents(), []);
      await logger.record({
        protocol: MailProtocol.Smtp,
        action: ActivityAction.Deliver,
        remoteAddress: "",
        mailboxAddress: "",
        senderAddress: "ada@acme.test",
        recipientAddresses: ["person@example.test"],
        subject: "After reset",
        byteCount: 4,
        result: ActivityResult.Rejected,
        detail: "recipient rejected"
      });
      const afterReset = await logger.attentionEvents();
      assert.equal(afterReset.length, 1);
      assert.equal(afterReset[0].subject, "After reset");
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
