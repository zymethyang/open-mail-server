import type { Server } from "node:http";
import { AccountRepository } from "../../src/components/account/index.js";
import { ActivityLogger } from "../../src/components/activity/index.js";
import { describeCertificateMaterial, loadCertificate, prepareCertificateMaterial, storeCertificateMaterial } from "../../src/components/certificate/index.js";
import { createOutgoingSigner } from "../../src/components/domainKey/index.js";
import { DeliveryService } from "../../src/components/delivery/index.js";
import type { MailExchangeResolver } from "../../src/components/mailExchange/interfaces/mailExchange.js";
import { MailboxEvents } from "../../src/components/mailboxEvents/index.js";
import { MessageRepository } from "../../src/components/message/index.js";
import { OrganizationRepository } from "../../src/components/organization/index.js";
import { SessionRepository } from "../../src/components/session/index.js";
import { SettingsRepository } from "../../src/components/settings/index.js";
import { SignInGuard } from "../../src/components/signIn/index.js";
import { createWebServer, startWebServer, type ListenerStatus } from "../../src/components/web/index.js";
import { startSmtpSink, type SmtpSink } from "./smtpSink.js";
import { createTemporaryStorage, removeTemporaryStorage } from "./temporaryStorage.js";
import { testConfiguration } from "./testConfiguration.js";

export interface JsonResponse {
  status: number;
  payload: Record<string, unknown>;
  cookieHeader: string;
}

export interface RunningWebConsole {
  baseUrl: string;
  storageDirectory: string;
  sink: SmtpSink;
  accountRepository: AccountRepository;
  messageRepository: MessageRepository;
  stop(): Promise<void>;
}

export function cookieHeader(lines: string[]): string {
  return lines
    .map((line) => line.split(";")[0].trim())
    .filter((line) => {
      const separator = line.indexOf("=");
      return separator > 0 && line.slice(separator + 1).length > 0;
    })
    .join("; ");
}

export async function requestJson(
  baseUrl: string,
  method: string,
  pathName: string,
  body?: unknown,
  cookieHeaderValue = "",
  extraHeaders: Record<string, string> = {}
): Promise<JsonResponse> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (cookieHeaderValue) {
    headers.Cookie = cookieHeaderValue;
  }
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  return { status: response.status, payload, cookieHeader: cookieHeader(lines) };
}

export async function startWebConsole(options: { configuredDomain?: string; serverName?: string; listenHost?: string; listenerStatus?: ListenerStatus[]; mailExchangeResolver?: (sink: SmtpSink) => MailExchangeResolver } = {}): Promise<RunningWebConsole> {
  const storageDirectory = await createTemporaryStorage();
  const sink = await startSmtpSink();
  const configuration = testConfiguration(storageDirectory);
  if (options.configuredDomain) {
    configuration.configuredDomain = options.configuredDomain;
  }
  configuration.publicHostname = "127.0.0.1";
  configuration.maximumMessageBytes = 4096;
  const accountRepository = new AccountRepository(storageDirectory);
  const organizationRepository = new OrganizationRepository(storageDirectory);
  const mailboxEvents = new MailboxEvents();
  const messageRepository = new MessageRepository(storageDirectory, mailboxEvents);
  const sessionRepository = new SessionRepository(storageDirectory);
  const activityLogger = new ActivityLogger(storageDirectory);
  const settingsRepository = new SettingsRepository(storageDirectory, configuration.maximumMessageBytes);
  const certificate = await loadCertificate(storageDirectory, [configuration.configuredDomain]);
  const signingDomain = async () => (await organizationRepository.read())?.domain || configuration.configuredDomain;
  const deliveryService = new DeliveryService({
    storageDirectory,
    accountRepository,
    messageRepository,
    activityLogger,
    mailExchangeResolver: options.mailExchangeResolver
      ? options.mailExchangeResolver(sink)
      : {
          async resolve() {
            return [{ host: "127.0.0.1", port: sink.port, trustedCertificate: sink.trustedCertificate }];
          }
        },
    serverDomain: signingDomain,
    announceName: async () => "127.0.0.1",
    readRelay: async () => (await settingsRepository.read()).relay,
    signOutgoingMessage: createOutgoingSigner(storageDirectory, signingDomain)
  });
  const server = createWebServer({
    configuration,
    accountRepository,
    organizationRepository,
    messageRepository,
    mailboxEvents,
    sessionRepository,
    activityLogger,
    deliveryService,
    signInGuard: new SignInGuard(),
    listenerStatus: options.listenerStatus || [],
    certificate,
    serverName: async () => options.serverName || "127.0.0.1",
    settingsRepository,
    readCertificate: async () => describeCertificateMaterial(certificate.certificate, certificate.privateKey),
    replaceCertificate: async (certificatePem, privateKeyPem, intermediateCertificatesPem = "") => {
      const prepared = prepareCertificateMaterial(certificatePem, privateKeyPem, intermediateCertificatesPem);
      const description = await storeCertificateMaterial(storageDirectory, certificatePem, privateKeyPem, intermediateCertificatesPem);
      certificate.privateKey = prepared.privateKey;
      certificate.certificate = prepared.certificate;
      return description;
    }
  });
  const port = await startWebServer(server, 0, options.listenHost || "127.0.0.1");
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    storageDirectory,
    sink,
    accountRepository,
    messageRepository,
    stop: async () => {
      await closeServer(server);
      await sink.stop();
      await removeTemporaryStorage(storageDirectory);
    }
  };
}

function closeServer(server: Server): Promise<void> {
  const closingServer = server as Server & { closeIdleConnections?: () => void };
  closingServer.closeIdleConnections?.();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
