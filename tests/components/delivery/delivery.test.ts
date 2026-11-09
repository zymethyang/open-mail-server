import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { AccountRole } from "../../../src/components/account/enums/accountRole.js";
import { ActivityAction } from "../../../src/components/activity/enums/activityAction.js";
import { ActivityResult } from "../../../src/components/activity/enums/activityResult.js";
import { ActivityLogger } from "../../../src/components/activity/index.js";
import { DeliveryService } from "../../../src/components/delivery/index.js";
import type { DeliveryService as DeliveryServiceContract } from "../../../src/components/delivery/interfaces/delivery.js";
import { readJson, writeJson } from "../../../src/components/jsonFile/index.js";
import type { MailExchangeResolver } from "../../../src/components/mailExchange/interfaces/mailExchange.js";
import { MailboxEvents } from "../../../src/components/mailboxEvents/index.js";
import { MessageRepository } from "../../../src/components/message/index.js";
import { MailProtocol } from "../../../src/components/protocol/enums/mailProtocol.js";
import { AccountRepository } from "../../../src/components/account/index.js";
import { RelaySecurity } from "../../../src/components/settings/enums/relaySecurity.js";
import type { MailRelaySettings } from "../../../src/components/settings/interfaces/settings.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { startSmtpSink } from "../../support/smtpSink.js";
import { statusCodeOf } from "../../support/statusCode.js";

describe("delivery service", { concurrency: 1 }, () => {
  it("stores local mail, relays outside mail, and queues a failure", async () => {
    const storageDirectory = await createTemporaryStorage();
    const sink = await startSmtpSink();
    const failing: MailExchangeResolver = {
      async resolve() {
        throw new Error("The other mail server is down");
      }
    };
    try {
      const local = await openDelivery(storageDirectory, {
        async resolve() {
          return [{ host: "127.0.0.1", port: sink.port }];
        }
      });
      await local.accountRepository.createAccount({
        address: "ada@acme.test",
        displayName: "Ada Admin",
        password: "correct-horse",
        role: AccountRole.Administrator,
        domain: "acme.test"
      });
      await local.accountRepository.createAccount({
        address: "bea@acme.test",
        displayName: "Bea Member",
        password: "member-horse",
        role: AccountRole.Member,
        domain: "acme.test"
      });

      const unavailable = await openDelivery(storageDirectory, failing, "");
      await assert.rejects(() => unavailable.deliveryService.deliver(deliveryRequest("ada@acme.test", ["bea@acme.test"])), (error: unknown) => statusCodeOf(error) === 450);
      await assert.rejects(() => local.deliveryService.deliver(deliveryRequest("ada@acme.test", [])), (error: unknown) => statusCodeOf(error) === 550);
      await assert.rejects(
        () => local.deliveryService.deliver({ ...deliveryRequest("ada@acme.test", ["bea@acme.test"]), rawBuffer: Buffer.alloc(0) }),
        (error: unknown) => statusCodeOf(error) === 550
      );
      await assert.rejects(
        () =>
          local.deliveryService.deliver({
            ...deliveryRequest("someone@acme.test", ["bea@acme.test"]),
            authenticatedAddress: "ada@acme.test"
          }),
        (error: unknown) => statusCodeOf(error) === 550 && (error as Error).message.includes("signed-in")
      );
      await assert.rejects(
        () => local.deliveryService.deliver(deliveryRequest("outside@example.test", ["missing@acme.test"])),
        (error: unknown) => statusCodeOf(error) === 550 && (error as Error).message.includes("does not exist")
      );
      await assert.rejects(
        () => local.deliveryService.deliver(deliveryRequest("ada@acme.test", ["missing@acme.test", "other@acme.test"])),
        (error: unknown) => statusCodeOf(error) === 550 && (error as Error).message === "Mailboxes missing@acme.test, other@acme.test do not exist"
      );
      await assert.rejects(
        () => local.deliveryService.deliver(deliveryRequest("ada@acme.test", ["bea@acme.test", "missing@acme.test"])),
        (error: unknown) => statusCodeOf(error) === 550 && (error as Error).message === "Mailbox missing@acme.test does not exist"
      );
      assert.equal((await local.messageRepository.listMessages("bea@acme.test", "inbox")).length, 0);
      await assert.rejects(
        () => local.deliveryService.deliver(deliveryRequest("outside@example.test", ["person@example.test"])),
        (error: unknown) => statusCodeOf(error) === 550 && (error as Error).message.includes("Relay denied")
      );

      const stored = await local.deliveryService.deliver(
        deliveryRequest("outside@example.test", ["Ada@acme.test", "ada@acme.test", "bea@acme.test"], "Hello from outside")
      );
      assert.deepEqual(stored.localRecipients, ["ada@acme.test", "bea@acme.test"]);
      assert.equal(stored.externalRecipients.length, 0);
      assert.equal((await local.messageRepository.listMessages("ada@acme.test", "inbox"))[0].text, "Hello from outside");
      assert.equal((await local.messageRepository.listMessages("bea@acme.test", "inbox")).length, 1);

      const relayed = await local.deliveryService.deliver({
        ...deliveryRequest("ada@acme.test", ["person@example.test"], "Leaving the building"),
        authenticatedAddress: "ada@acme.test"
      });
      assert.deepEqual(relayed.externalRecipients, ["person@example.test"]);
      assert.equal(relayed.queuedRecipients.length, 0);
      assert.equal(sink.messages.some((message) => message.includes("Leaving the building")), true);
      assert.equal((await local.messageRepository.listMessages("ada@acme.test", "sent")).length, 1);

      const blocked = await openDelivery(storageDirectory, failing);
      const queued = await blocked.deliveryService.deliver({
        ...deliveryRequest("ada@acme.test", ["person@example.test"], "Please retry"),
        authenticatedAddress: "ada@acme.test"
      });
      assert.deepEqual(queued.queuedRecipients, ["person@example.test"]);
      assert.match(queued.warning, /down/);
      assert.equal(await blocked.deliveryService.queuedCount(), 1);
      const events = await local.activityLogger.query({
        protocol: MailProtocol.Smtp,
        result: ActivityResult.Accepted,
        search: "person@example.test",
        limit: 10
      });
      assert.equal(events.some((event) => event.detail === "relayed"), true);
      assert.equal(events[0].action, ActivityAction.Deliver);
      assert.equal(events[0].protocol, MailProtocol.Smtp);
    } finally {
      await sink.stop();
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("retries a queued message and bounces after the last attempt", async () => {
    const storageDirectory = await createTemporaryStorage();
    const sink = await startSmtpSink();
    let fail = true;
    try {
      const opened = await openDelivery(storageDirectory, {
        async resolve() {
          if (fail) {
            throw new Error("still down");
          }
          return [{ host: "127.0.0.1", port: sink.port }];
        }
      });
      await opened.accountRepository.createAccount({
        address: "ada@acme.test",
        displayName: "Ada Admin",
        password: "correct-horse",
        role: AccountRole.Administrator,
        domain: "acme.test"
      });
      const queued = await opened.deliveryService.deliver({
        ...deliveryRequest("ada@acme.test", ["person@example.test"], "Retry me"),
        authenticatedAddress: "ada@acme.test"
      });
      assert.equal(queued.queuedRecipients.length, 1);
      await opened.deliveryService.processQueue();
      assert.equal(sink.messages.length, 0);
      const queueDirectory = path.join(storageDirectory, "outbound-queue");
      const names = await listJson(queueDirectory);
      assert.equal(names.length, 1);
      const item = await readJson<{ nextAttemptAt: string; attempts: number }>(path.join(queueDirectory, names[0]));
      item.nextAttemptAt = new Date(Date.now() - 1000).toISOString();
      await writeJson(path.join(queueDirectory, names[0]), item);
      fail = false;
      await opened.deliveryService.processQueue();
      assert.equal(sink.messages.some((message) => message.includes("Retry me")), true);
      assert.equal(await opened.deliveryService.queuedCount(), 0);

      fail = true;
      const identifier = "bounceattempt000000000001";
      await writeJson(path.join(queueDirectory, `${identifier}.json`), {
        identifier,
        serverDomain: "acme.test",
        senderAddress: "ada@acme.test",
        authenticatedAddress: "ada@acme.test",
        recipientAddresses: ["person@example.test"],
        rawEncoded: Buffer.from("Subject: Bounce\r\n\r\nRetry me\r\n").toString("base64"),
        attempts: 7,
        nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
        lastError: "still down"
      });
      await opened.deliveryService.processQueue();
      assert.equal(await opened.deliveryService.queuedCount(), 0);
      const inbox = await opened.messageRepository.listMessages("ada@acme.test", "inbox");
      assert.equal(inbox.some((message) => message.subject === "Delivery failed"), true);
    } finally {
      await sink.stop();
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("lists failed email and resends the selection or every waiting message", async () => {
    const storageDirectory = await createTemporaryStorage();
    const sink = await startSmtpSink();
    try {
      const opened = await openDelivery(storageDirectory, {
        async resolve(domain) {
          if (domain === "blocked.example") {
            throw new Error("still down");
          }
          return [{ host: "127.0.0.1", port: sink.port }];
        }
      });
      await opened.accountRepository.createAccount({
        address: "ada@acme.test",
        displayName: "Ada Admin",
        password: "correct-horse",
        role: AccountRole.Administrator,
        domain: "acme.test"
      });
      const queueDirectory = path.join(storageDirectory, "outbound-queue");
      const first = queuedFailure("firstfailure000001", "person@example.test", "First failure");
      const second = queuedFailure("secondfailure00001", "held@blocked.example", "Second failure");
      await writeJson(path.join(queueDirectory, `${first.identifier}.json`), first);
      await writeJson(path.join(queueDirectory, `${second.identifier}.json`), second);

      const listed = await opened.deliveryService.listFailedEmail();
      assert.deepEqual(listed.map((message) => message.subject).sort(), ["First failure", "Second failure"]);
      assert.equal(listed.every((message) => message.lastError === "The other mail server is down"), true);

      const selected = await opened.deliveryService.resendFailedEmail([first.identifier]);
      assert.deepEqual(selected.sent, [first.identifier]);
      assert.deepEqual(selected.givenUp, []);
      assert.deepEqual(selected.stillWaiting.map((message) => message.identifier), [second.identifier]);
      assert.equal(sink.messages.some((message) => message.includes("First failure")), true);
      assert.equal(sink.messages.some((message) => message.includes("Second failure")), false);

      await assert.rejects(
        () => opened.deliveryService.resendFailedEmail(["missing-message"]),
        (error: unknown) => statusCodeOf(error) === 404
      );
      assert.equal((await opened.deliveryService.listFailedEmail()).length, 1);

      const rejected = await opened.deliveryService.resendFailedEmail([]);
      assert.deepEqual(rejected.sent, []);
      assert.deepEqual(rejected.givenUp, []);
      assert.equal(rejected.stillWaiting[0].identifier, second.identifier);
      assert.equal(rejected.stillWaiting[0].attempts, 2);
      assert.match(rejected.stillWaiting[0].lastError, /still down/);

      const stored = await readJson<{ attempts: number }>(path.join(queueDirectory, `${second.identifier}.json`));
      stored.attempts = 7;
      await writeJson(path.join(queueDirectory, `${second.identifier}.json`), stored);
      const returned = await opened.deliveryService.resendFailedEmail([second.identifier]);
      assert.deepEqual(returned.sent, []);
      assert.deepEqual(returned.givenUp, [second.identifier]);
      assert.deepEqual(returned.stillWaiting, []);
      const inbox = await opened.messageRepository.listMessages("ada@acme.test", "inbox");
      assert.equal(inbox.some((message) => message.subject === "Delivery failed" && message.text.includes("still down")), true);
      const events = await opened.activityLogger.query({ protocol: "", result: "", search: "Second failure", limit: 10 });
      assert.equal(events.some((event) => event.result === ActivityResult.Failed && event.subject === "Second failure"), true);
    } finally {
      await sink.stop();
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("covers an empty queue, list order, a missing subject, duplicates, and a mixed selection", async () => {
    const storageDirectory = await createTemporaryStorage();
    const sink = await startSmtpSink();
    try {
      const opened = await openDelivery(storageDirectory, {
        async resolve(domain) {
          if (domain === "blocked.example") {
            throw new Error("still down");
          }
          return [{ host: "127.0.0.1", port: sink.port }];
        }
      });
      await opened.accountRepository.createAccount({
        address: "ada@acme.test",
        displayName: "Ada Admin",
        password: "correct-horse",
        role: AccountRole.Administrator,
        domain: "acme.test"
      });
      assert.deepEqual(await opened.deliveryService.listFailedEmail(), []);
      assert.deepEqual(await opened.deliveryService.resendFailedEmail([]), { sent: [], givenUp: [], stillWaiting: [] });

      const queueDirectory = path.join(storageDirectory, "outbound-queue");
      const sooner = queuedFailure("sooner000000000001", "soon@example.test", "", new Date(Date.now() + 60 * 1000).toISOString());
      const later = queuedFailure(
        "later0000000000001",
        "later@example.test, copy@example.test",
        "Later failure",
        new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      );
      const blocked = queuedFailure("blocked00000000001", "held@blocked.example", "Blocked failure");
      await writeJson(path.join(queueDirectory, `${later.identifier}.json`), later);
      await writeJson(path.join(queueDirectory, `${sooner.identifier}.json`), sooner);
      await writeJson(path.join(queueDirectory, `${blocked.identifier}.json`), blocked);

      const listed = await opened.deliveryService.listFailedEmail();
      assert.deepEqual(listed.map((message) => message.identifier), [sooner.identifier, blocked.identifier, later.identifier]);
      assert.equal(listed[0].subject, "(no subject)");
      assert.deepEqual(listed[2].recipientAddresses, ["later@example.test", "copy@example.test"]);
      assert.equal(JSON.stringify(listed).includes("rawEncoded"), false);

      await assert.rejects(
        () => opened.deliveryService.resendFailedEmail([sooner.identifier, "missing-message"]),
        (error: unknown) => statusCodeOf(error) === 404
      );
      assert.equal(sink.messages.length, 0);
      assert.equal((await opened.deliveryService.listFailedEmail()).length, 3);

      const duplicated = await opened.deliveryService.resendFailedEmail([`  ${sooner.identifier}  `, sooner.identifier]);
      assert.deepEqual(duplicated.sent, [sooner.identifier]);
      assert.equal(sink.messages.filter((message) => message.includes("Please retry")).length, 1);
      const accepted = await opened.activityLogger.query({ protocol: MailProtocol.Web, result: ActivityResult.Accepted, search: "(no subject)", limit: 10 });
      assert.equal(accepted.some((event) => event.subject === "(no subject)" && event.recipientAddresses.includes("soon@example.test")), true);

      const mixed = await opened.deliveryService.resendFailedEmail([later.identifier, blocked.identifier]);
      assert.deepEqual(mixed.sent, [later.identifier]);
      assert.deepEqual(mixed.givenUp, []);
      assert.equal(mixed.stillWaiting.length, 1);
      assert.equal(mixed.stillWaiting[0].identifier, blocked.identifier);
      assert.equal(mixed.stillWaiting[0].attempts, 2);
      assert.equal(Date.parse(mixed.stillWaiting[0].nextAttemptAt) > Date.now(), true);
      assert.equal(sink.messages.some((message) => message.includes("Later failure")), true);
      assert.equal(sink.messages.some((message) => message.includes("Blocked failure")), false);
    } finally {
      await sink.stop();
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("stores outside mail before the remote server answers", async () => {
    const storageDirectory = await createTemporaryStorage();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const opened = await openDelivery(storageDirectory, {
        async resolve() {
          await gate;
          throw new Error("The remote mail server timed out");
        }
      });
      await opened.accountRepository.createAccount({
        address: "ada@acme.test",
        displayName: "Ada Admin",
        password: "correct-horse",
        role: AccountRole.Administrator,
        domain: "acme.test"
      });
      const started = Date.now();
      const result = await opened.deliveryService.deliver({
        ...deliveryRequest("ada@acme.test", ["person@example.test"], "Do not wait"),
        authenticatedAddress: "ada@acme.test",
        acceptExternalImmediately: true
      });
      assert.ok(Date.now() - started < 1000);
      assert.deepEqual(result.queuedRecipients, ["person@example.test"]);
      assert.equal(result.warning, "");
      const listed = await opened.deliveryService.listFailedEmail();
      assert.equal(listed.length, 1);
      assert.equal(listed[0].lastError, "The message is waiting to be sent.");
      release();
      const finished = Date.now();
      while (Date.now() - finished < 2000) {
        const waiting = await opened.deliveryService.listFailedEmail();
        if (waiting[0]?.lastError.includes("timed out")) {
          assert.equal(waiting.length, 1);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail("The failed message did not stay queued for another attempt");
    } finally {
      release();
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("sends through a configured relay", async () => {
    const storageDirectory = await createTemporaryStorage();
    const sink = await startSmtpSink();
    try {
      const relay: MailRelaySettings = {
        enabled: true,
        host: "127.0.0.1",
        port: sink.port,
        username: "relay-user",
        password: "relay-secret",
        security: RelaySecurity.Plain
      };
      const opened = await openDelivery(
        storageDirectory,
        {
          async resolve() {
            throw new Error("direct delivery should not be used");
          }
        },
        "acme.test",
        relay
      );
      await opened.accountRepository.createAccount({
        address: "ada@acme.test",
        displayName: "Ada Admin",
        password: "correct-horse",
        role: AccountRole.Administrator,
        domain: "acme.test"
      });
      const result = await opened.deliveryService.deliver({
        ...deliveryRequest("ada@acme.test", ["person@example.test"], "Through the relay"),
        authenticatedAddress: "ada@acme.test"
      });
      assert.equal(result.queuedRecipients.length, 0);
      assert.equal(sink.messages.some((message) => message.includes("Through the relay")), true);
    } finally {
      await sink.stop();
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("bounces a missing company mailbox back to the signed-in sender", async () => {
    const storageDirectory = await createTemporaryStorage();
    const sink = await startSmtpSink();
    try {
      const opened = await openDelivery(storageDirectory, {
        async resolve() {
          return [{ host: "127.0.0.1", port: sink.port }];
        }
      });
      await opened.accountRepository.createAccount({
        address: "ada@acme.test",
        displayName: "Ada Admin",
        password: "correct-horse",
        role: AccountRole.Administrator,
        domain: "acme.test"
      });
      await opened.accountRepository.createAccount({
        address: "bea@acme.test",
        displayName: "Bea Member",
        password: "member-horse",
        role: AccountRole.Member,
        domain: "acme.test"
      });
      const missing = await opened.deliveryService.deliver({
        ...deliveryRequest("ada@acme.test", ["admin@acme.test"], "For admin"),
        authenticatedAddress: "ada@acme.test",
        bounceMissingMailboxes: true
      });
      assert.deepEqual(missing.localRecipients, []);
      const several = await opened.deliveryService.deliver({
        ...deliveryRequest("ada@acme.test", ["admin@acme.test", "acme@acme.test"], "For both"),
        authenticatedAddress: "ada@acme.test",
        bounceMissingMailboxes: true
      });
      assert.deepEqual(several.localRecipients, []);
      const mixed = await opened.deliveryService.deliver({
        ...deliveryRequest("ada@acme.test", ["bea@acme.test", "admin@acme.test"], "For Bea and admin"),
        authenticatedAddress: "ada@acme.test",
        bounceMissingMailboxes: true
      });
      assert.deepEqual(mixed.localRecipients, ["bea@acme.test"]);
      assert.equal((await opened.messageRepository.listMessages("bea@acme.test", "inbox")).length, 1);
      assert.equal(await opened.accountRepository.exists("admin@acme.test"), false);
      const sent = await opened.messageRepository.listMessages("ada@acme.test", "sent");
      assert.equal(sent.length, 3);
      const inbox = await opened.messageRepository.listMessages("ada@acme.test", "inbox");
      assert.equal(inbox.filter((message) => message.subject === "Delivery failed").length, 3);
      assert.equal(inbox.some((message) => message.text.includes("admin@acme.test is not a mailbox on this server.")), true);
      assert.equal(inbox.some((message) => message.text.includes("admin@acme.test, acme@acme.test")), true);
      const events = await opened.activityLogger.query({ protocol: "", result: ActivityResult.Failed, search: "admin@acme.test", limit: 10 });
      assert.equal(events.length, 3);
    } finally {
      await sink.stop();
      await removeTemporaryStorage(storageDirectory);
    }
  });
});

function queuedFailure(identifier: string, recipient: string, subject: string, nextAttemptAt = "", attempts = 1) {
  const subjectHeader = subject ? `Subject: ${subject}\r\n` : "";
  return {
    identifier,
    serverDomain: "acme.test",
    senderAddress: "ada@acme.test",
    authenticatedAddress: "ada@acme.test",
    recipientAddresses: recipient.includes(",") ? recipient.split(",").map((address) => address.trim()) : [recipient],
    rawEncoded: Buffer.from(`From: ada@acme.test\r\nTo: ${recipient}\r\n${subjectHeader}\r\nPlease retry\r\n`).toString("base64"),
    attempts,
    nextAttemptAt: nextAttemptAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    lastError: "The other mail server is down"
  };
}

function deliveryRequest(fromAddress: string, recipientAddresses: string[], text = "Hello") {
  return {
    fromAddress,
    recipientAddresses,
    rawBuffer: Buffer.from(`From: ${fromAddress}\r\nTo: ${recipientAddresses[0] || fromAddress}\r\nSubject: Delivery\r\n\r\n${text}\r\n`),
    authenticatedAddress: "",
    remoteAddress: "127.0.0.1",
    protocol: MailProtocol.Smtp
  };
}

async function openDelivery(
  storageDirectory: string,
  mailExchangeResolver: MailExchangeResolver,
  domain = "acme.test",
  relay?: MailRelaySettings
) {
  const accountRepository = new AccountRepository(storageDirectory);
  const messageRepository = new MessageRepository(storageDirectory, new MailboxEvents());
  const activityLogger = new ActivityLogger(storageDirectory);
  const deliveryService: DeliveryServiceContract = new DeliveryService({
    storageDirectory,
    accountRepository,
    messageRepository,
    activityLogger,
    mailExchangeResolver,
    serverDomain: async () => domain,
    announceName: async () => domain || "localhost",
    readRelay: async () =>
      relay || {
        enabled: false,
        host: "",
        port: 587,
        username: "",
        password: "",
        security: RelaySecurity.StartTls
      }
  });
  return { accountRepository, messageRepository, activityLogger, deliveryService };
}

async function listJson(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
