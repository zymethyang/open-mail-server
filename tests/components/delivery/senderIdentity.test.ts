import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AccountRole } from "../../../src/components/account/enums/accountRole.js";
import { AccountRepository } from "../../../src/components/account/index.js";
import { ActivityLogger } from "../../../src/components/activity/index.js";
import { DeliveryService } from "../../../src/components/delivery/index.js";
import type { DeliveryRequest } from "../../../src/components/delivery/interfaces/delivery.js";
import { MailboxEvents } from "../../../src/components/mailboxEvents/index.js";
import { MessageRepository } from "../../../src/components/message/index.js";
import { MailProtocol } from "../../../src/components/protocol/enums/mailProtocol.js";
import { RelaySecurity } from "../../../src/components/settings/enums/relaySecurity.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { startSmtpSink, type SmtpSink } from "../../support/smtpSink.js";
import { statusCodeOf } from "../../support/statusCode.js";

const signedInAddress = "ada@acme.test";
const otherMailbox = "bea@acme.test";
const outsideAddress = "person@example.test";

describe("signed-in sender identity", { concurrency: 1 }, () => {
  let storageDirectory = "";
  let sink: SmtpSink;
  let accountRepository: AccountRepository;
  let messageRepository: MessageRepository;
  let deliveryService: DeliveryService;

  async function findMessage(address: string, folderName: string, subject: string) {
    const messages = await messageRepository.listMessages(address, folderName);
    const message = messages.find((item) => item.subject === subject);
    assert.ok(message, `${folderName} for ${address} is missing ${subject}`);
    return message;
  }

  async function storedSubject(address: string, folderName: string, subject: string): Promise<boolean> {
    const messages = await messageRepository.listMessages(address, folderName);
    return messages.some((message) => message.subject === subject);
  }

  before(async () => {
    storageDirectory = await createTemporaryStorage();
    sink = await startSmtpSink();
    accountRepository = new AccountRepository(storageDirectory);
    messageRepository = new MessageRepository(storageDirectory, new MailboxEvents());
    deliveryService = new DeliveryService({
      storageDirectory,
      accountRepository,
      messageRepository,
      activityLogger: new ActivityLogger(storageDirectory),
      mailExchangeResolver: {
        async resolve() {
          return [{ host: "127.0.0.1", port: sink.port }];
        }
      },
      serverDomain: async () => "acme.test",
      announceName: async () => "acme.test",
      readRelay: async () => ({
        enabled: false,
        host: "",
        port: 587,
        username: "",
        password: "",
        security: RelaySecurity.StartTls
      })
    });
    await accountRepository.createAccount({
      address: signedInAddress,
      displayName: "Ada Admin",
      password: "correct-horse",
      role: AccountRole.Administrator,
      domain: "acme.test"
    });
    await accountRepository.createAccount({
      address: otherMailbox,
      displayName: "Bea Member",
      password: "member-horse",
      role: AccountRole.Member,
      domain: "acme.test"
    });
  });

  after(async () => {
    await sink.stop();
    if (storageDirectory) {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("delivers local and outside mail when the envelope, From, and Sender match the signed-in mailbox", async () => {
    const local = await deliveryService.deliver(
      signedInRequest({
        envelopeAddress: "Ada@Acme.Test",
        fromHeader: '"Ada Admin" <Ada@Acme.Test>',
        senderHeader: "ada@acme.test (Ada Admin)",
        recipientAddresses: [otherMailbox],
        text: "Matches the signed-in mailbox"
      })
    );
    assert.deepEqual(local.localRecipients, [otherMailbox]);
    const stored = await findMessage(otherMailbox, "inbox", "Matches the signed-in mailbox");
    assert.equal(stored.fromAddress, signedInAddress);
    assert.equal(stored.fromName, "Ada Admin");
    const sent = await findMessage(signedInAddress, "sent", "Matches the signed-in mailbox");
    assert.equal(sent.fromAddress, signedInAddress);

    const beforeSenders = sink.envelopeSenders.length;
    const outside = await deliveryService.deliver(
      signedInRequest({
        envelopeAddress: signedInAddress,
        fromHeader: signedInAddress,
        recipientAddresses: [outsideAddress],
        text: "Outside as the signed-in mailbox"
      })
    );
    assert.deepEqual(outside.externalRecipients, [outsideAddress]);
    assert.equal(outside.queuedRecipients.length, 0);
    assert.equal(sink.envelopeSenders[beforeSenders], `MAIL FROM:<${signedInAddress}>`);
    assert.equal(sink.messages.some((message) => message.includes("Outside as the signed-in mailbox")), true);
  });

  it("rejects another mailbox in the envelope while the From header matches", async () => {
    await assertSenderRejected(
      signedInRequest({
        envelopeAddress: otherMailbox,
        fromHeader: signedInAddress,
        recipientAddresses: [otherMailbox],
        text: "Envelope belongs to Bea"
      })
    );
  });

  it("rejects another local mailbox in the From header while the envelope matches", async () => {
    await assertSenderRejected(
      signedInRequest({
        envelopeAddress: signedInAddress,
        fromHeader: '"Ada Admin" <bea@acme.test>',
        recipientAddresses: [otherMailbox],
        text: "From header belongs to Bea"
      })
    );
  });

  it("rejects an outside address in the From header and does not relay it", async () => {
    const beforeMessages = sink.messages.length;
    const beforeSenders = sink.envelopeSenders.length;
    await assertSenderRejected(
      signedInRequest({
        envelopeAddress: signedInAddress,
        fromHeader: outsideAddress,
        recipientAddresses: [outsideAddress],
        text: "From header is outside"
      })
    );
    assert.equal(sink.messages.length, beforeMessages);
    assert.equal(sink.envelopeSenders.length, beforeSenders);
    assert.equal(await deliveryService.queuedCount(), 0);
  });

  it("rejects a From header that includes the signed-in mailbox and another mailbox", async () => {
    await assertSenderRejected(
      signedInRequest({
        envelopeAddress: signedInAddress,
        fromHeader: `${signedInAddress}, ${otherMailbox}`,
        recipientAddresses: [otherMailbox],
        text: "From header lists two mailboxes"
      })
    );
  });

  it("rejects a From header with no mailbox address", async () => {
    await assertSenderRejected(
      signedInRequest({
        envelopeAddress: signedInAddress,
        fromHeader: "Bea Member",
        recipientAddresses: [otherMailbox],
        text: "From header has no mailbox"
      })
    );
  });

  it("rejects a display name that is another email address", async () => {
    await assertSenderRejected(
      signedInRequest({
        envelopeAddress: signedInAddress,
        fromHeader: `"${otherMailbox}" <${signedInAddress}>`,
        recipientAddresses: [otherMailbox],
        text: "Display name is another mailbox"
      })
    );
  });

  it("rejects a Sender header for another mailbox", async () => {
    await assertSenderRejected(
      signedInRequest({
        envelopeAddress: signedInAddress,
        fromHeader: `"Ada Admin" <${signedInAddress}>`,
        senderHeader: otherMailbox,
        recipientAddresses: [otherMailbox],
        text: "Sender header belongs to Bea"
      })
    );
  });

  it("rejects an empty envelope when the From header is another mailbox", async () => {
    await assertSenderRejected(
      signedInRequest({
        envelopeAddress: "",
        fromHeader: otherMailbox,
        recipientAddresses: [otherMailbox],
        text: "Empty envelope with Bea's address"
      })
    );
  });

  it("uses the signed-in mailbox when the envelope is empty and the headers match", async () => {
    const beforeSenders = sink.envelopeSenders.length;
    const delivered = await deliveryService.deliver(
      signedInRequest({
        envelopeAddress: "",
        fromHeader: `"Ada Admin" <${signedInAddress}>`,
        recipientAddresses: [outsideAddress],
        text: "Empty envelope stays Ada"
      })
    );
    assert.deepEqual(delivered.externalRecipients, [outsideAddress]);
    assert.equal(sink.envelopeSenders[beforeSenders], `MAIL FROM:<${signedInAddress}>`);
    const sent = await findMessage(signedInAddress, "sent", "Empty envelope stays Ada");
    assert.equal(sent.fromAddress, signedInAddress);
  });

  it("uses the signed-in mailbox when the message has no From or Sender header", async () => {
    const delivered = await deliveryService.deliver(
      signedInRequest({
        envelopeAddress: signedInAddress,
        fromHeader: "",
        recipientAddresses: [otherMailbox],
        text: "No From header"
      })
    );
    assert.deepEqual(delivered.localRecipients, [otherMailbox]);
    const stored = await findMessage(otherMailbox, "inbox", "No From header");
    assert.equal(stored.fromAddress, signedInAddress);
  });

  it("still receives mail from outside when nobody is signed in", async () => {
    const delivered = await deliveryService.deliver({
      fromAddress: outsideAddress,
      recipientAddresses: [signedInAddress],
      rawBuffer: rawMessage({
        fromHeader: `Outside Person <${outsideAddress}>`,
        recipientAddresses: [signedInAddress],
        text: "Ordinary outside mail"
      }),
      authenticatedAddress: "",
      remoteAddress: "127.0.0.1",
      protocol: MailProtocol.Smtp
    });
    assert.deepEqual(delivered.localRecipients, [signedInAddress]);
    const stored = await findMessage(signedInAddress, "inbox", "Ordinary outside mail");
    assert.equal(stored.fromAddress, outsideAddress);
    assert.equal((await messageRepository.listMessages(signedInAddress, "sent")).some((message) => message.subject === "Ordinary outside mail"), false);
  });

  async function assertSenderRejected(request: DeliveryRequest): Promise<void> {
    const subject = request.rawBuffer.toString("utf8").split("\r\n").find((line) => line.startsWith("Subject: "))?.slice("Subject: ".length) || "";
    await assert.rejects(() => deliveryService.deliver(request), (error: unknown) => {
      return statusCodeOf(error) === 550 && (error as Error).message === "Sender must match the signed-in mailbox";
    });
    assert.equal(await storedSubject(signedInAddress, "inbox", subject), false);
    assert.equal(await storedSubject(signedInAddress, "sent", subject), false);
    assert.equal(await storedSubject(otherMailbox, "inbox", subject), false);
    assert.equal(await storedSubject(otherMailbox, "sent", subject), false);
  }
});

function signedInRequest(input: {
  envelopeAddress: string;
  fromHeader: string;
  senderHeader?: string;
  recipientAddresses: string[];
  text: string;
}): DeliveryRequest {
  return {
    fromAddress: input.envelopeAddress,
    recipientAddresses: input.recipientAddresses,
    rawBuffer: rawMessage(input),
    authenticatedAddress: signedInAddress,
    remoteAddress: "127.0.0.1",
    protocol: MailProtocol.Smtp
  };
}

function rawMessage(input: { fromHeader: string; senderHeader?: string; recipientAddresses: string[]; text: string }): Buffer {
  const lines: string[] = [];
  if (input.fromHeader) {
    lines.push(`From: ${input.fromHeader}`);
  }
  if (input.senderHeader) {
    lines.push(`Sender: ${input.senderHeader}`);
  }
  lines.push(`To: ${input.recipientAddresses.join(", ")}`);
  lines.push(`Subject: ${input.text}`);
  lines.push("");
  lines.push(input.text);
  return Buffer.from(`${lines.join("\r\n")}\r\n`);
}
