import { randomBytes } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson } from "../jsonFile/index.js";
import type { DeliveryDependencies, DeliveryService as DeliveryServiceContract, FailedEmail } from "./interfaces/delivery.js";
import type { MailRelaySettings } from "../settings/interfaces/settings.js";
import { domainOf, normalizeAddress } from "../text/index.js";
import { deliverToExchange, type SubmissionRelay } from "../outboundMail/index.js";
import { createMessageIdentifier, createRawMessage, createStoredMessage, parseRawMessage, senderMailboxAddresses } from "../mime/index.js";
import { ActivityAction } from "../activity/enums/activityAction.js";
import { ActivityResult } from "../activity/enums/activityResult.js";
import { MailFolderName } from "../message/enums/mailFolderName.js";
import { MailProtocol } from "../protocol/enums/mailProtocol.js";
import { oneLine } from "../text/index.js";

interface QueuedDelivery {
  identifier: string;
  serverDomain: string;
  senderAddress: string;
  authenticatedAddress: string;
  recipientAddresses: string[];
  rawEncoded: string;
  attempts: number;
  nextAttemptAt: string;
  lastError: string;
}

function deliveryError(message: string, statusCode = 550): Error {
  return Object.assign(new Error(message), { statusCode });
}

function assertSignedInSender(rawBuffer: Buffer, envelopeAddress: string, authenticatedAddress: string): void {
  const signedInAddress = normalizeAddress(authenticatedAddress);
  if (!signedInAddress) {
    return;
  }
  if (envelopeAddress && envelopeAddress !== signedInAddress) {
    throw deliveryError("Sender must match the signed-in mailbox");
  }
  const headers = senderMailboxAddresses(rawBuffer);
  for (const addresses of [headers.from, headers.sender]) {
    if (!addresses) {
      continue;
    }
    if (addresses.length === 0 || addresses.some((address) => address !== signedInAddress)) {
      throw deliveryError("Sender must match the signed-in mailbox");
    }
  }
}

function createDeliveryService(dependencies: DeliveryDependencies): DeliveryServiceContract {
  const queueDirectory = path.join(dependencies.storageDirectory, "outbound-queue");

  async function writeQueue(item: QueuedDelivery): Promise<void> {
    await writeJson(queuedFilePath(item.identifier), item);
  }

  function relayCredentials(relay: MailRelaySettings): SubmissionRelay | null {
    if (!relay.enabled || !relay.host) {
      return null;
    }
    return { username: relay.username, password: relay.password, security: relay.security };
  }

  async function sendExternal(item: Omit<QueuedDelivery, "identifier" | "attempts" | "nextAttemptAt" | "lastError">): Promise<void> {
    const unsignedMessage = Buffer.from(item.rawEncoded, "base64");
    const rawMessage = dependencies.signOutgoingMessage ? await dependencies.signOutgoingMessage(unsignedMessage) : unsignedMessage;
    const settings = await dependencies.readRelay();
    const relay = relayCredentials(settings);
    if (relay) {
      await deliverToExchange(
        { host: settings.host, port: settings.port },
        {
          serverDomain: item.serverDomain,
          senderAddress: item.senderAddress,
          recipientAddresses: item.recipientAddresses,
          rawMessage
        },
        relay
      );
      return;
    }
    const grouped = new Map<string, string[]>();
    for (const recipient of item.recipientAddresses) {
      const host = domainOf(recipient);
      const current = grouped.get(host) || [];
      current.push(recipient);
      grouped.set(host, current);
    }
    for (const [domain, recipients] of grouped) {
      const exchanges = await dependencies.mailExchangeResolver.resolve(domain);
      let lastError = "No mail server accepted the message";
      let delivered = false;
      for (const exchange of exchanges) {
        try {
          await deliverToExchange(exchange, {
            serverDomain: item.serverDomain,
            senderAddress: item.senderAddress,
            recipientAddresses: recipients,
            rawMessage
          });
          delivered = true;
          break;
        } catch (error) {
          lastError = oneLine((error as Error).message, 300);
        }
      }
      if (!delivered) {
        throw new Error(lastError);
      }
    }
  }

  async function readQueuedDeliveries(): Promise<QueuedDelivery[]> {
    let names: string[] = [];
    try {
      names = await readdir(queueDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const items: QueuedDelivery[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      let item: QueuedDelivery;
      try {
        item = await readJson<QueuedDelivery>(path.join(queueDirectory, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error;
      }
      if (/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.identifier) && name === `${item.identifier}.json`) {
        items.push(item);
      }
    }
    items.sort((left, right) => Date.parse(left.nextAttemptAt) - Date.parse(right.nextAttemptAt));
    return items;
  }

  function queuedFilePath(identifier: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(identifier)) {
      throw deliveryError("Failed email was not found", 404);
    }
    return path.join(queueDirectory, `${identifier}.json`);
  }

  function describeFailedEmail(item: QueuedDelivery): FailedEmail {
    let subject = "";
    try {
      subject = parseRawMessage(Buffer.from(item.rawEncoded || "", "base64")).subject;
    } catch {
      subject = "";
    }
    return {
      identifier: item.identifier,
      senderAddress: item.senderAddress,
      recipientAddresses: [...item.recipientAddresses],
      subject: subject || "(no subject)",
      attempts: item.attempts,
      nextAttemptAt: item.nextAttemptAt,
      lastError: item.lastError
    };
  }

  async function recordAccepted(item: QueuedDelivery, protocol: MailProtocol): Promise<void> {
    const described = describeFailedEmail(item);
    await rm(queuedFilePath(item.identifier), { force: true });
    await dependencies.activityLogger.record({
      protocol,
      action: ActivityAction.Deliver,
      remoteAddress: "",
      mailboxAddress: item.authenticatedAddress,
      senderAddress: item.senderAddress,
      recipientAddresses: item.recipientAddresses,
      subject: described.subject,
      byteCount: Buffer.from(item.rawEncoded, "base64").length,
      result: ActivityResult.Accepted,
      detail: "relayed"
    });
  }

  async function bounce(senderAddress: string, recipients: string[], warning: string, domain: string): Promise<void> {
    if (!senderAddress || !(await dependencies.accountRepository.exists(senderAddress))) {
      return;
    }
    const rawBuffer = createRawMessage({
      fromName: "Mail Delivery",
      fromAddress: `mailer-daemon@${domain}`,
      toAddresses: [senderAddress],
      copyAddresses: [],
      subject: "Delivery failed",
      text: `The message could not be delivered to ${recipients.join(", ")}.\r\n\r\n${warning}`,
      messageIdentifierHeader: createMessageIdentifier(domain),
      inReplyTo: "",
      date: new Date()
    });
    const parsed = parseRawMessage(rawBuffer);
    const message = createStoredMessage(parsed, rawBuffer, `mailer-daemon@${domain}`);
    await dependencies.messageRepository.appendMessage(senderAddress, "inbox", message);
  }

  async function recordAnotherFailure(item: QueuedDelivery, error: unknown, protocol: MailProtocol): Promise<"waiting" | "givenUp"> {
    const domain = await dependencies.serverDomain();
    item.attempts += 1;
    item.lastError = oneLine((error as Error).message, 300);
    item.nextAttemptAt = new Date(Date.now() + Math.min(item.attempts, 12) * 5 * 60 * 1000).toISOString();
    const described = describeFailedEmail(item);
    if (item.attempts >= 8) {
      await rm(queuedFilePath(item.identifier), { force: true });
      await bounce(item.authenticatedAddress || item.senderAddress, item.recipientAddresses, item.lastError, domain);
      await dependencies.activityLogger.record({
        protocol,
        action: ActivityAction.Deliver,
        remoteAddress: "",
        mailboxAddress: item.authenticatedAddress,
        senderAddress: item.senderAddress,
        recipientAddresses: item.recipientAddresses,
        subject: described.subject,
        byteCount: 0,
        result: ActivityResult.Failed,
        detail: item.lastError
      });
      return "givenUp";
    }
    await writeQueue(item);
    return "waiting";
  }

  async function sendQueued(item: QueuedDelivery, protocol: MailProtocol): Promise<"sent" | "waiting" | "givenUp"> {
    try {
      await sendExternal(item);
      await recordAccepted(item, protocol);
      return "sent";
    } catch (error) {
      return recordAnotherFailure(item, error, protocol);
    }
  }

  return {
    async deliver(request) {
      const domain = await dependencies.serverDomain();
      const announcedName = oneLine(await dependencies.announceName(), 253) || domain;
      if (!domain) {
        throw deliveryError("This server has no company domain yet", 450);
      }
      const envelopeFrom = normalizeAddress(request.fromAddress);
      const recipients = [...new Set(request.recipientAddresses.map((address) => normalizeAddress(address)).filter(Boolean))];
      if (!recipients.length) {
        throw deliveryError("No recipients");
      }
      if (!request.rawBuffer.length) {
        throw deliveryError("Empty message");
      }
      assertSignedInSender(request.rawBuffer, envelopeFrom, request.authenticatedAddress);
      const localRecipients: string[] = [];
      const externalRecipients: string[] = [];
      const missingRecipients: string[] = [];
      for (const recipient of recipients) {
        if (domainOf(recipient) === domain) {
          if (await dependencies.accountRepository.exists(recipient)) {
            localRecipients.push(recipient);
          } else {
            missingRecipients.push(recipient);
          }
          continue;
        }
        if (!request.authenticatedAddress) {
          throw deliveryError("Relay denied");
        }
        externalRecipients.push(recipient);
      }
      if (missingRecipients.length && !request.bounceMissingMailboxes) {
        if (missingRecipients.length === 1) {
          throw deliveryError(`Mailbox ${missingRecipients[0]} does not exist`);
        }
        throw deliveryError(`Mailboxes ${missingRecipients.join(", ")} do not exist`);
      }

      const parsed = parseRawMessage(request.rawBuffer);
      const message = createStoredMessage(parsed, request.rawBuffer, envelopeFrom || request.authenticatedAddress);
      for (const recipient of localRecipients) {
        await dependencies.messageRepository.appendMessage(recipient, MailFolderName.Inbox, {
          ...message,
          seen: false,
          draft: false,
          deleted: false
        });
      }
      if (request.authenticatedAddress) {
        await dependencies.messageRepository.appendMessage(request.authenticatedAddress, MailFolderName.Sent, {
          ...message,
          seen: true,
          draft: false,
          deleted: false
        });
      }
      if (request.bounceMissingMailboxes && missingRecipients.length) {
        const warning = missingRecipients.length === 1
          ? `${missingRecipients[0]} is not a mailbox on this server.`
          : `These addresses are not mailboxes on this server: ${missingRecipients.join(", ")}.`;
        await bounce(request.authenticatedAddress, missingRecipients, warning, domain);
        await dependencies.activityLogger.record({
          protocol: request.protocol,
          action: ActivityAction.Deliver,
          remoteAddress: request.remoteAddress,
          mailboxAddress: request.authenticatedAddress,
          senderAddress: envelopeFrom,
          recipientAddresses: missingRecipients,
          subject: message.subject,
          byteCount: 0,
          result: ActivityResult.Failed,
          detail: warning
        });
      }
      if (localRecipients.length) {
        await dependencies.activityLogger.record({
          protocol: request.protocol,
          action: ActivityAction.Deliver,
          remoteAddress: request.remoteAddress,
          mailboxAddress: localRecipients.join(", "),
          senderAddress: envelopeFrom,
          recipientAddresses: localRecipients,
          subject: message.subject,
          byteCount: request.rawBuffer.length,
          result: ActivityResult.Delivered,
          detail: request.authenticatedAddress ? "sent" : "stored"
        });
      }

      const queuedRecipients: string[] = [];
      let warning = "";
      if (externalRecipients.length) {
        const outbound = {
          serverDomain: announcedName,
          senderAddress: envelopeFrom || request.authenticatedAddress,
          authenticatedAddress: request.authenticatedAddress,
          recipientAddresses: externalRecipients,
          rawEncoded: request.rawBuffer.toString("base64")
        };
        const queued: QueuedDelivery = {
          ...outbound,
          identifier: randomBytes(12).toString("hex"),
          attempts: 0,
          nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          lastError: "The message is waiting to be sent."
        };
        if (request.acceptExternalImmediately) {
          await writeQueue(queued);
          queuedRecipients.push(...externalRecipients);
          void sendQueued(queued, request.protocol).catch((error: unknown) => {
            console.error(oneLine((error as Error).message, 300));
          });
        } else {
          try {
            await sendExternal(outbound);
            await dependencies.activityLogger.record({
              protocol: request.protocol,
              action: ActivityAction.Deliver,
              remoteAddress: request.remoteAddress,
              mailboxAddress: request.authenticatedAddress,
              senderAddress: outbound.senderAddress,
              recipientAddresses: externalRecipients,
              subject: message.subject,
              byteCount: request.rawBuffer.length,
              result: ActivityResult.Accepted,
              detail: "relayed"
            });
          } catch (error) {
            warning = oneLine((error as Error).message, 300);
            queued.attempts = 1;
            queued.nextAttemptAt = new Date(Date.now() + 60 * 1000).toISOString();
            queued.lastError = warning;
            await writeQueue(queued);
            queuedRecipients.push(...externalRecipients);
            await dependencies.activityLogger.record({
              protocol: request.protocol,
              action: ActivityAction.Queue,
              remoteAddress: request.remoteAddress,
              mailboxAddress: request.authenticatedAddress,
              senderAddress: outbound.senderAddress,
              recipientAddresses: externalRecipients,
              subject: message.subject,
              byteCount: request.rawBuffer.length,
              result: ActivityResult.Queued,
              detail: warning
            });
          }
        }
      }
      return { localRecipients, externalRecipients, queuedRecipients, warning };
    },

    async processQueue() {
      const queuedDeliveries = await readQueuedDeliveries();
      for (const item of queuedDeliveries) {
        if (Date.parse(item.nextAttemptAt) > Date.now()) {
          continue;
        }
        await sendQueued(item, MailProtocol.Smtp);
      }
    },

    async listFailedEmail() {
      const queuedDeliveries = await readQueuedDeliveries();
      return queuedDeliveries.map((item) => describeFailedEmail(item));
    },

    async resendFailedEmail(identifiers: string[]) {
      const queuedDeliveries = await readQueuedDeliveries();
      const requested = [...new Set(identifiers.map((identifier) => identifier.trim()).filter(Boolean))];
      const selected = requested.length
        ? requested.map((identifier) => {
            const item = queuedDeliveries.find((queued) => queued.identifier === identifier);
            if (!item) {
              throw deliveryError(`Failed email ${identifier} was not found`, 404);
            }
            return item;
          })
        : queuedDeliveries;
      const sent: string[] = [];
      const givenUp: string[] = [];
      for (const item of selected) {
        const outcome = await sendQueued(item, MailProtocol.Web);
        if (outcome === "sent") {
          sent.push(item.identifier);
        } else if (outcome === "givenUp") {
          givenUp.push(item.identifier);
        }
      }
      return {
        sent,
        givenUp,
        stillWaiting: (await readQueuedDeliveries()).map((item) => describeFailedEmail(item))
      };
    },

    async queuedCount() {
      try {
        const names = await readdir(queueDirectory);
        return names.filter((name) => name.endsWith(".json")).length;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return 0;
        }
        throw error;
      }
    }
  };
}

export class DeliveryService implements DeliveryServiceContract {
  private readonly service: DeliveryServiceContract;

  constructor(dependencies: DeliveryDependencies) {
    this.service = createDeliveryService(dependencies);
  }

  deliver(request: Parameters<DeliveryServiceContract["deliver"]>[0]) {
    return this.service.deliver(request);
  }

  processQueue() {
    return this.service.processQueue();
  }

  queuedCount() {
    return this.service.queuedCount();
  }

  listFailedEmail() {
    return this.service.listFailedEmail();
  }

  resendFailedEmail(identifiers: string[]) {
    return this.service.resendFailedEmail(identifiers);
  }
}
