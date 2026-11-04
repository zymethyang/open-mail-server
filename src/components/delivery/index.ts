import { randomBytes } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson } from "../jsonFile/index.js";
import type { DeliveryDependencies, DeliveryService as DeliveryServiceContract } from "./interfaces/delivery.js";
import type { MailRelaySettings } from "../settings/interfaces/settings.js";
import { domainOf, normalizeAddress } from "../text/index.js";
import { deliverToExchange, type SubmissionRelay } from "../outboundMail/index.js";
import { createMessageIdentifier, createRawMessage, createStoredMessage, parseRawMessage } from "../mime/index.js";
import { ActivityAction } from "../activity/enums/activityAction.js";
import { ActivityResult } from "../activity/enums/activityResult.js";
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

function createDeliveryService(dependencies: DeliveryDependencies): DeliveryServiceContract {
  const queueDirectory = path.join(dependencies.storageDirectory, "outbound-queue");

  async function writeQueue(item: QueuedDelivery): Promise<void> {
    await writeJson(path.join(queueDirectory, `${item.identifier}.json`), item);
  }

  function relayCredentials(relay: MailRelaySettings): SubmissionRelay | null {
    if (!relay.enabled || !relay.host) {
      return null;
    }
    return { username: relay.username, password: relay.password, security: relay.security };
  }

  async function sendExternal(item: Omit<QueuedDelivery, "identifier" | "attempts" | "nextAttemptAt" | "lastError">): Promise<void> {
    const rawMessage = Buffer.from(item.rawEncoded, "base64");
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
      if (request.authenticatedAddress && envelopeFrom && envelopeFrom !== request.authenticatedAddress) {
        throw deliveryError("Sender must match the signed-in mailbox");
      }
      const localRecipients: string[] = [];
      const externalRecipients: string[] = [];
      for (const recipient of recipients) {
        if (domainOf(recipient) === domain) {
          if (await dependencies.accountRepository.exists(recipient)) {
            localRecipients.push(recipient);
          } else {
            throw deliveryError(`Mailbox ${recipient} does not exist`);
          }
        } else if (!request.authenticatedAddress) {
          throw deliveryError("Relay denied");
        } else {
          externalRecipients.push(recipient);
        }
      }

      const parsed = parseRawMessage(request.rawBuffer);
      const message = createStoredMessage(parsed, request.rawBuffer, envelopeFrom || request.authenticatedAddress);
      for (const recipient of localRecipients) {
        await dependencies.messageRepository.appendMessage(recipient, "inbox", {
          ...message,
          seen: false,
          draft: false,
          deleted: false
        });
      }
      if (request.authenticatedAddress) {
        await dependencies.messageRepository.appendMessage(request.authenticatedAddress, "sent", {
          ...message,
          seen: true,
          draft: false,
          deleted: false
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
          const queued: QueuedDelivery = {
            ...outbound,
            identifier: randomBytes(12).toString("hex"),
            attempts: 1,
            nextAttemptAt: new Date(Date.now() + 60 * 1000).toISOString(),
            lastError: warning
          };
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
      return { localRecipients, externalRecipients, queuedRecipients, warning };
    },

    async processQueue() {
      let names: string[] = [];
      try {
        names = await readdir(queueDirectory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return;
        }
        throw error;
      }
      const domain = await dependencies.serverDomain();
      for (const name of names) {
        if (!name.endsWith(".json")) {
          continue;
        }
        const filePath = path.join(queueDirectory, name);
        const item = await readJson<QueuedDelivery>(filePath);
        if (Date.parse(item.nextAttemptAt) > Date.now()) {
          continue;
        }
        try {
          await sendExternal(item);
          await rm(filePath, { force: true });
          await dependencies.activityLogger.record({
            protocol: MailProtocol.Smtp,
            action: ActivityAction.Deliver,
            remoteAddress: "",
            mailboxAddress: item.authenticatedAddress,
            senderAddress: item.senderAddress,
            recipientAddresses: item.recipientAddresses,
            subject: "",
            byteCount: Buffer.from(item.rawEncoded, "base64").length,
            result: ActivityResult.Accepted,
            detail: "relayed"
          });
        } catch (error) {
          item.attempts += 1;
          item.lastError = oneLine((error as Error).message, 300);
          item.nextAttemptAt = new Date(Date.now() + Math.min(item.attempts, 12) * 5 * 60 * 1000).toISOString();
          if (item.attempts >= 8) {
            await rm(filePath, { force: true });
            await bounce(item.authenticatedAddress || item.senderAddress, item.recipientAddresses, item.lastError, domain);
            await dependencies.activityLogger.record({
              protocol: MailProtocol.Smtp,
              action: ActivityAction.Deliver,
              remoteAddress: "",
              mailboxAddress: item.authenticatedAddress,
              senderAddress: item.senderAddress,
              recipientAddresses: item.recipientAddresses,
              subject: "",
              byteCount: 0,
              result: ActivityResult.Failed,
              detail: item.lastError
            });
          } else {
            await writeQueue(item);
          }
        }
      }
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
}
