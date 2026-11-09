import type { Server } from "node:net";
import os from "node:os";
import tls from "node:tls";
import type { Configuration } from "../configuration/index.js";
import { configurationWithListeners, loadConfiguration } from "../configuration/index.js";
import { createWebServer, startWebServer, type ListenerStatus } from "../web/index.js";
import { DeliveryService } from "../delivery/index.js";
import type { MailExchangeResolver } from "../mailExchange/interfaces/mailExchange.js";
import { DnsMailExchangeResolver } from "../mailExchange/index.js";
import { MailboxEvents } from "../mailboxEvents/index.js";
import { ImapServer } from "../imap/index.js";
import { describeListenError } from "../protocol/utils/listen.js";
import { Pop3Server } from "../pop3/index.js";
import { SmtpServer } from "../smtp/index.js";
import { describeCertificateMaterial, ensureSelfSignedCertificate, prepareCertificateMaterial, storeCertificateMaterial } from "../certificate/index.js";
import { secureOptions } from "../protocol/utils/transportSecurity.js";
import { createOutgoingSigner } from "../domainKey/index.js";
import { openSecureStorage } from "../secureStorage/index.js";
import { SettingsRepository } from "../settings/index.js";
import { SignInGuard } from "../signIn/index.js";
import { AccountRepository } from "../account/index.js";
import { ActivityLogger } from "../activity/index.js";
import { MessageRepository } from "../message/index.js";
import { OrganizationRepository } from "../organization/index.js";
import { SessionRepository } from "../session/index.js";
import type { RunningEmailServer } from "./interfaces/runningEmailServer.js";
export type { RunningEmailServer };

function localCertificateNames(): string[] {
  const names = ["localhost", "127.0.0.1"];
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
  return names;
}

async function remember(
  listeners: ListenerStatus[],
  servers: Server[],
  description: Omit<ListenerStatus, "started" | "detail" | "port"> & { port: number },
  starter: () => Promise<{ server: Server; port: number }>
): Promise<void> {
  try {
    const started = await starter();
    servers.push(started.server);
    listeners.push({ ...description, port: started.port, started: true, detail: "" });
  } catch (error) {
    listeners.push({ ...description, started: false, detail: describeListenError(error as NodeJS.ErrnoException) });
  }
}

export async function startEmailServer(options?: {
  configuration?: Configuration;
  mailExchangeResolver?: MailExchangeResolver;
}): Promise<RunningEmailServer> {
  const baseConfiguration = options?.configuration || loadConfiguration();
  await openSecureStorage(baseConfiguration.storageDirectory);
  const accountRepository = new AccountRepository(baseConfiguration.storageDirectory);
  const settingsRepository = new SettingsRepository(baseConfiguration.storageDirectory);
  const storedSettings = await settingsRepository.read();
  const configuration =
    options?.configuration || !storedSettings.listenersSaved
      ? baseConfiguration
      : configurationWithListeners(baseConfiguration, storedSettings.listeners);
  const organizationRepository = new OrganizationRepository(configuration.storageDirectory);
  const mailboxEvents = new MailboxEvents();
  const messageRepository = new MessageRepository(configuration.storageDirectory, mailboxEvents);
  const sessionRepository = new SessionRepository(configuration.storageDirectory);
  const activityLogger = new ActivityLogger(configuration.storageDirectory);
  const signInGuard = new SignInGuard();
  const organization = await organizationRepository.read();
  const certificate = await ensureSelfSignedCertificate(configuration.storageDirectory, [
    ...localCertificateNames(),
    configuration.configuredDomain,
    configuration.publicHostname,
    storedSettings.publicHostname,
    organization?.domain || ""
  ]);
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
    mailExchangeResolver: options?.mailExchangeResolver || new DnsMailExchangeResolver(),
    serverDomain: signingDomain,
    announceName: serverName,
    readRelay: () => settingsRepository.read().then((settings) => settings.relay),
    signOutgoingMessage: createOutgoingSigner(configuration.storageDirectory, signingDomain)
  });
  const listeners: ListenerStatus[] = [];
  const servers: Server[] = [];
  const shared = {
    configuration,
    certificate,
    accountRepository,
    signInGuard,
    activityLogger
  };

  await remember(listeners, servers, { name: "SMTP", port: configuration.smtpPort, security: "Plain and STARTTLS", purpose: "Receive mail" }, () =>
    new SmtpServer({
      ...shared,
      endpoint: { port: configuration.smtpPort, secure: false, requireAuthentication: false },
      deliveryService,
      serverName
    }).start()
  );
  await remember(listeners, servers, { name: "SMTP", port: configuration.smtpSecurePort, security: "TLS", purpose: "Send mail" }, () =>
    new SmtpServer({
      ...shared,
      endpoint: { port: configuration.smtpSecurePort, secure: true, requireAuthentication: true },
      deliveryService,
      serverName
    }).start()
  );
  await remember(listeners, servers, { name: "SMTP", port: configuration.smtpSubmissionPort, security: "STARTTLS", purpose: "Send mail" }, () =>
    new SmtpServer({
      ...shared,
      endpoint: { port: configuration.smtpSubmissionPort, secure: false, requireAuthentication: true },
      deliveryService,
      serverName
    }).start()
  );
  await remember(listeners, servers, { name: "IMAP", port: configuration.imapPort, security: "Plain and STARTTLS", purpose: "Read mail" }, () =>
    new ImapServer({ ...shared, port: configuration.imapPort, secure: false, messageRepository, mailboxEvents }).start()
  );
  await remember(listeners, servers, { name: "IMAP", port: configuration.imapSecurePort, security: "TLS", purpose: "Read mail" }, () =>
    new ImapServer({ ...shared, port: configuration.imapSecurePort, secure: true, messageRepository, mailboxEvents }).start()
  );
  await remember(listeners, servers, { name: "POP3", port: configuration.pop3Port, security: "Plain and STLS", purpose: "Read mail" }, () =>
    new Pop3Server({ ...shared, port: configuration.pop3Port, secure: false, messageRepository }).start()
  );
  await remember(listeners, servers, { name: "POP3", port: configuration.pop3SecurePort, security: "TLS", purpose: "Read mail" }, () =>
    new Pop3Server({ ...shared, port: configuration.pop3SecurePort, secure: true, messageRepository }).start()
  );

  async function replaceCertificate(certificatePem: string, privateKeyPem: string, intermediateCertificatesPem = "") {
    const prepared = prepareCertificateMaterial(certificatePem, privateKeyPem, intermediateCertificatesPem);
    const description = await storeCertificateMaterial(configuration.storageDirectory, certificatePem, privateKeyPem, intermediateCertificatesPem);
    certificate.privateKey = prepared.privateKey;
    certificate.certificate = prepared.certificate;
    const material = { privateKey: prepared.privateKey, certificate: prepared.certificate };
    for (const server of servers) {
      const secureServer = server as tls.Server;
      if (typeof secureServer.setSecureContext === "function") {
        secureServer.setSecureContext(secureOptions(material));
      }
    }
    return description;
  }

  const webServer = createWebServer({
    configuration,
    accountRepository,
    organizationRepository,
    messageRepository,
    mailboxEvents,
    sessionRepository,
    activityLogger,
    deliveryService,
    signInGuard,
    listenerStatus: listeners,
    certificate,
    serverName,
    settingsRepository,
    readCertificate: async () => describeCertificateMaterial(certificate.certificate, certificate.privateKey),
    replaceCertificate
  });
  await remember(listeners, servers, { name: "Web", port: configuration.webPort, security: configuration.secureWeb ? "HTTPS" : "HTTP", purpose: "Administrator and mailbox" }, async () => {
    const port = await startWebServer(webServer, configuration.webPort, configuration.host);
    return { server: webServer, port };
  });

  const queueTimer = setInterval(() => {
    deliveryService.processQueue().catch((error: Error) => {
      console.error(`Outbound queue failed: ${error.message}`);
    });
  }, 30 * 1000);
  queueTimer.unref();

  return {
    configuration,
    listeners,
    async stop() {
      clearInterval(queueTimer);
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              const listeningServer = server as Server & { closeAllConnections?: () => void };
              listeningServer.closeAllConnections?.();
              server.close(() => resolve());
            })
        )
      );
    }
  };
}
