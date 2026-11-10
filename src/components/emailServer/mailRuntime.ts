import os from "node:os";
import type { Configuration } from "../configuration/index.js";
import { DeliveryService } from "../delivery/index.js";
import type { MailExchangeResolver } from "../mailExchange/interfaces/mailExchange.js";
import { MailboxEvents } from "../mailboxEvents/index.js";
import { ensureSelfSignedCertificate, type ServerCertificate } from "../certificate/index.js";
import { createOutgoingSigner } from "../domainKey/index.js";
import { openSecureStorage } from "../secureStorage/index.js";
import { SettingsRepository } from "../settings/index.js";
import { SignInGuard } from "../signIn/index.js";
import { AccountRepository } from "../account/index.js";
import { ActivityLogger } from "../activity/index.js";
import { MessageRepository } from "../message/index.js";
import { OrganizationRepository } from "../organization/index.js";
import { SessionRepository } from "../session/index.js";
import type { MailRuntime } from "./interfaces/mailRuntime.js";

export function certificateNames(configuration: Configuration, publicHostname: string, domain: string): string[] {
  const names = ["localhost", "127.0.0.1", configuration.configuredDomain, configuration.publicHostname, publicHostname, domain];
  for (const records of Object.values(os.networkInterfaces())) {
    for (const record of records || []) {
      const family = String(record.family);
      const linkLocal = record.address.startsWith("169.254.");
      if ((family !== "IPv4" && family !== "4") || record.internal || linkLocal || names.includes(record.address)) {
        continue;
      }
      names.push(record.address);
    }
  }
  return names.filter(Boolean);
}

export async function ensureMailCertificate(configuration: Configuration): Promise<ServerCertificate> {
  await openSecureStorage(configuration.storageDirectory);
  const settingsRepository = new SettingsRepository(configuration.storageDirectory);
  const organizationRepository = new OrganizationRepository(configuration.storageDirectory);
  const storedSettings = await settingsRepository.read();
  const organization = await organizationRepository.read();
  return ensureSelfSignedCertificate(
    configuration.storageDirectory,
    certificateNames(configuration, storedSettings.publicHostname, organization?.domain || "")
  );
}

export async function createMailRuntime(input: {
  configuration: Configuration;
  mailExchangeResolver: MailExchangeResolver;
}): Promise<MailRuntime> {
  const configuration = input.configuration;
  await openSecureStorage(configuration.storageDirectory);
  const accountRepository = new AccountRepository(configuration.storageDirectory);
  const settingsRepository = new SettingsRepository(configuration.storageDirectory);
  const organizationRepository = new OrganizationRepository(configuration.storageDirectory);
  const mailboxEvents = new MailboxEvents();
  const messageRepository = new MessageRepository(configuration.storageDirectory, mailboxEvents);
  const sessionRepository = new SessionRepository(configuration.storageDirectory);
  const activityLogger = new ActivityLogger(configuration.storageDirectory);
  const signInGuard = new SignInGuard();
  const certificate = await ensureMailCertificate(configuration);
  const serverName = async (): Promise<string> => {
    const settings = await settingsRepository.read();
    if (settings.publicHostname) {
      return settings.publicHostname;
    }
    if (configuration.publicHostname) {
      return configuration.publicHostname;
    }
    const currentOrganization = await organizationRepository.read();
    return currentOrganization?.domain || configuration.configuredDomain || "localhost";
  };
  const signingDomain = async () => (await organizationRepository.read())?.domain || configuration.configuredDomain;
  const deliveryService = new DeliveryService({
    storageDirectory: configuration.storageDirectory,
    accountRepository,
    messageRepository,
    activityLogger,
    mailExchangeResolver: input.mailExchangeResolver,
    serverDomain: signingDomain,
    announceName: serverName,
    readRelay: () => settingsRepository.read().then((settings) => settings.relay),
    signOutgoingMessage: createOutgoingSigner(configuration.storageDirectory, signingDomain)
  });
  return {
    configuration,
    certificate,
    accountRepository,
    organizationRepository,
    messageRepository,
    sessionRepository,
    activityLogger,
    settingsRepository,
    signInGuard,
    deliveryService,
    mailboxEvents,
    serverName
  };
}
