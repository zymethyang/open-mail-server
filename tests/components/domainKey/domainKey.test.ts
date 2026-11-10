import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountRole } from "../../../src/components/account/enums/accountRole.js";
import { AccountRepository } from "../../../src/components/account/index.js";
import { ActivityLogger } from "../../../src/components/activity/index.js";
import { DeliveryService } from "../../../src/components/delivery/index.js";
import { domainKeySelector, openDomainKey, signatureMatches, signWithDomainKey } from "../../../src/components/domainKey/index.js";
import { createRawMessage } from "../../../src/components/mime/index.js";
import { MailboxEvents } from "../../../src/components/mailboxEvents/index.js";
import { MessageRepository } from "../../../src/components/message/index.js";
import { MailProtocol } from "../../../src/components/protocol/enums/mailProtocol.js";
import { RelaySecurity } from "../../../src/components/settings/enums/relaySecurity.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { startSmtpSink } from "../../support/smtpSink.js";

describe("domain key", { concurrency: 1 }, () => {
  it("keeps one key and signs outgoing mail that still verifies", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      const first = await openDomainKey(storageDirectory);
      const second = await openDomainKey(storageDirectory);
      assert.equal(second.recordValue, first.recordValue);
      assert.match(first.recordValue, /^v=DKIM1; k=rsa; p=[A-Za-z0-9+/=]+$/);
      const message = createRawMessage({
        fromName: "Ada Admin",
        fromAddress: "ada@acme.test",
        toAddresses: ["person@example.test"],
        copyAddresses: ["copy@example.test"],
        subject: "Hello there",
        text: "Leaving the building",
        messageIdentifierHeader: "<one@acme.test>",
        inReplyTo: "",
        date: new Date("2026-11-09T16:00:00Z")
      });
      const signed = signWithDomainKey(message, "acme.test", first.privateKey, new Date("2026-11-09T16:00:00Z"));
      const text = signed.toString("utf8");
      assert.equal(text.startsWith("DKIM-Signature:"), true);
      assert.match(text, new RegExp(`d=acme\\.test; s=${domainKeySelector}`));
      assert.equal(text.includes("Leaving the building"), true);
      assert.equal(signatureMatches(signed, first.privateKey), true);
      const tampered = Buffer.from(text.replace("Leaving the building", "Leaving the office"), "utf8");
      assert.equal(signatureMatches(tampered, first.privateKey), false);
      const changedSubject = Buffer.from(text.replace("Subject: Hello there", "Subject: Hello changed"), "utf8");
      assert.equal(signatureMatches(changedSubject, first.privateKey), false);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("signs mail as it leaves for another server", async () => {
    const storageDirectory = await createTemporaryStorage();
    const sink = await startSmtpSink();
    try {
      const domainKey = await openDomainKey(storageDirectory);
      const accountRepository = new AccountRepository(storageDirectory);
      const messageRepository = new MessageRepository(storageDirectory, new MailboxEvents());
      await accountRepository.createAccount({
        address: "ada@acme.test",
        displayName: "Ada Admin",
        password: "correct-horse",
        role: AccountRole.Administrator,
        domain: "acme.test"
      });
      const deliveryService = new DeliveryService({
        storageDirectory,
        accountRepository,
        messageRepository,
        activityLogger: new ActivityLogger(storageDirectory),
        mailExchangeResolver: {
          async resolve() {
            return [{ host: "127.0.0.1", port: sink.port, trustedCertificate: sink.trustedCertificate }];
          }
        },
        serverDomain: async () => "acme.test",
        announceName: async () => "mail.acme.test",
        readRelay: async () => ({
          enabled: false,
          host: "",
          port: 587,
          username: "",
          password: "",
          security: RelaySecurity.StartTls
        }),
        signOutgoingMessage: async (rawMessage) => signWithDomainKey(rawMessage, "acme.test", domainKey.privateKey)
      });
      const result = await deliveryService.deliver({
        fromAddress: "ada@acme.test",
        recipientAddresses: ["person@example.test"],
        rawBuffer: Buffer.from("From: ada@acme.test\r\nTo: person@example.test\r\nSubject: Outbound\r\n\r\nSigned on the way out\r\n"),
        authenticatedAddress: "ada@acme.test",
        remoteAddress: "127.0.0.1",
        protocol: MailProtocol.Smtp
      });
      assert.deepEqual(result.externalRecipients, ["person@example.test"]);
      const delivered = sink.messages.find((message) => message.includes("Signed on the way out")) || "";
      assert.equal(delivered.startsWith("DKIM-Signature:"), true);
      assert.equal(signatureMatches(Buffer.from(delivered, "utf8"), domainKey.privateKey), true);
    } finally {
      await sink.stop();
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
