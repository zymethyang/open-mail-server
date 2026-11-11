import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountRole } from "../../../src/components/account/enums/accountRole.js";
import { AccountRepository } from "../../../src/components/account/index.js";
import { ActivityLogger } from "../../../src/components/activity/index.js";
import { AddressRouteRepository } from "../../../src/components/addressRoute/index.js";
import { DeliveryService } from "../../../src/components/delivery/index.js";
import { MailboxEvents } from "../../../src/components/mailboxEvents/index.js";
import { MessageRepository } from "../../../src/components/message/index.js";
import { MailProtocol } from "../../../src/components/protocol/enums/mailProtocol.js";
import { RelaySecurity } from "../../../src/components/settings/enums/relaySecurity.js";
import { SettingsRepository } from "../../../src/components/settings/index.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { statusCodeOf } from "../../support/statusCode.js";

function deliveryRequest(fromAddress: string, recipientAddresses: string[], text = "Hello") {
  return {
    fromAddress,
    recipientAddresses,
    rawBuffer: Buffer.from(`From: ${fromAddress}\r\nTo: ${recipientAddresses[0] || fromAddress}\r\nSubject: Delivery\r\n\r\n${text}\r\n`),
    authenticatedAddress: "",
    remoteAddress: "198.51.100.8",
    protocol: MailProtocol.Smtp
  };
}

async function openDelivery(storageDirectory: string) {
  const accountRepository = new AccountRepository(storageDirectory);
  const messageRepository = new MessageRepository(storageDirectory, new MailboxEvents());
  const deliveryService = new DeliveryService({
    storageDirectory,
    accountRepository,
    messageRepository,
    activityLogger: new ActivityLogger(storageDirectory),
    mailExchangeResolver: { async resolve() { return []; } },
    serverDomain: async () => "acme.test",
    announceName: async () => "acme.test",
    readRelay: async () => ({ enabled: false, host: "", port: 587, username: "", password: "", security: RelaySecurity.StartTls })
  });
  await accountRepository.createAccount({
    address: "ada@acme.test",
    displayName: "Ada Admin",
    password: "correct-horse",
    role: AccountRole.Administrator,
    domain: "acme.test"
  });
  await accountRepository.createAccount({
    address: "bea@acme.test",
    displayName: "Bea Member",
    password: "member-horse",
    role: AccountRole.Member,
    domain: "acme.test"
  });
  return { accountRepository, messageRepository, deliveryService, routes: new AddressRouteRepository(storageDirectory) };
}

describe("addresses people already use", () => {
  it("delivers aliases, lists, extra domains, and catch-all mail", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      const opened = await openDelivery(storageDirectory);
      await opened.routes.addAlias({ address: "sales@acme.test", mailboxAddress: "bea@acme.test" }, "acme.test");
      await opened.routes.addDomain("example.com", "acme.test");
      await opened.routes.addList({ address: "team@example.com", mailboxAddresses: ["ada@acme.test", "bea@acme.test"] }, "acme.test");
      await opened.routes.addCatchAll({ domain: "example.com", mailboxAddress: "ada@acme.test" }, "acme.test");

      const alias = await opened.deliveryService.deliver(deliveryRequest("outside@elsewhere.test", ["Sales@acme.test"], "Alias body"));
      assert.deepEqual(alias.localRecipients, ["bea@acme.test"]);
      const list = await opened.deliveryService.deliver(deliveryRequest("outside@elsewhere.test", ["team@example.com"], "List body"));
      assert.deepEqual(list.localRecipients, ["ada@acme.test", "bea@acme.test"]);
      const catchAll = await opened.deliveryService.deliver(deliveryRequest("outside@elsewhere.test", ["unknown@example.com"], "Catch-all body"));
      assert.deepEqual(catchAll.localRecipients, ["ada@acme.test"]);

      await assert.rejects(
        () => opened.deliveryService.deliver(deliveryRequest("outside@elsewhere.test", ["unknown@acme.test"])),
        (error: unknown) => statusCodeOf(error) === 550 && (error as Error).message.includes("does not exist")
      );
      await assert.rejects(
        () => opened.deliveryService.deliver(deliveryRequest("outside@elsewhere.test", ["person@elsewhere.test"])),
        (error: unknown) => statusCodeOf(error) === 550 && (error as Error).message.includes("Relay denied")
      );

      const bea = await opened.messageRepository.listMessages("bea@acme.test", "inbox");
      assert.deepEqual(bea.map((message) => message.snippet).sort(), ["Alias body", "List body"]);
      const ada = await opened.messageRepository.listMessages("ada@acme.test", "inbox");
      assert.equal(ada.filter((message) => message.snippet === "Catch-all body").length, 1);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("rejects a blocked sender and unsafe content before storing mail", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      const opened = await openDelivery(storageDirectory);
      await opened.routes.addBlockedSender("spam@bad.test");
      await assert.rejects(
        () => opened.deliveryService.deliver(deliveryRequest("spam@bad.test", ["ada@acme.test"])),
        (error: unknown) => statusCodeOf(error) === 550 && (error as Error).message.includes("blocked")
      );
      const virus = Buffer.from("From: ada@bad.test\r\nTo: ada@acme.test\r\nSubject: Virus\r\n\r\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\r\n");
      await assert.rejects(
        () => opened.deliveryService.deliver({ ...deliveryRequest("ada@bad.test", ["ada@acme.test"]), rawBuffer: virus }),
        (error: unknown) => statusCodeOf(error) === 550 && (error as Error).message.includes("content")
      );
      assert.equal((await opened.messageRepository.listMessages("ada@acme.test", "inbox")).length, 0);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("enforces the saved message cap and mailbox quota", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      const opened = await openDelivery(storageDirectory);
      await new SettingsRepository(storageDirectory).update({
        publicHostname: "",
        relay: { enabled: false, host: "", port: 587, username: "", password: "", security: RelaySecurity.StartTls },
        limits: {
          maximumMessageBytes: 2048,
          mailboxQuotaBytes: 2500,
          maximumUnauthenticatedConnections: 2,
          maximumUnauthenticatedMessages: 2
        }
      });
      const oversized = Buffer.from(`From: outside@elsewhere.test\r\nTo: ada@acme.test\r\nSubject: Big\r\n\r\n${"x".repeat(2100)}\r\n`);
      await assert.rejects(
        () => opened.deliveryService.deliver({ ...deliveryRequest("outside@elsewhere.test", ["ada@acme.test"]), rawBuffer: oversized }),
        (error: unknown) => statusCodeOf(error) === 552 && (error as Error).message.includes("too large")
      );
      await opened.deliveryService.deliver(deliveryRequest("outside@elsewhere.test", ["ada@acme.test"], "x".repeat(1800)));
      await assert.rejects(
        () => opened.deliveryService.deliver(deliveryRequest("outside@elsewhere.test", ["ada@acme.test"], "y".repeat(1800))),
        (error: unknown) => statusCodeOf(error) === 552 && (error as Error).message.includes("quota")
      );
      assert.equal((await opened.messageRepository.listMessages("ada@acme.test", "inbox")).length, 1);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
