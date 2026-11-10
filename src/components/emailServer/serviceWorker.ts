import type { Server } from "node:net";
import { parentPort, workerData, type MessagePort } from "node:worker_threads";
import { createWebServer, startWebServer, type ListenerStatus } from "../web/index.js";
import { ImapServer } from "../imap/index.js";
import { describeListenError } from "../protocol/utils/listen.js";
import { Pop3Server } from "../pop3/index.js";
import { SmtpServer } from "../smtp/index.js";
import { describeCertificateMaterial, prepareCertificateMaterial, storeCertificateMaterial } from "../certificate/index.js";
import { applyCertificate, followCertificateReplacement, publishCertificateReplacement } from "../certificate/certificateBroadcast.js";
import type { MailExchange } from "../mailExchange/interfaces/mailExchange.js";
import type { MailRuntime } from "./interfaces/mailRuntime.js";
import { createMailRuntime } from "./mailRuntime.js";
import { ServiceName } from "./enums/serviceName.js";
import { WorkerMessageKind } from "./enums/workerMessageKind.js";
import type { ParentResponse, WorkerInput, WorkerMessage } from "./interfaces/workerMessage.js";

const parent = parentPort;
const input = workerData as WorkerInput | undefined;

if (!parent || !input?.service || !input.configuration) {
  throw new Error("The service worker needs a parent thread and a service name");
}
const thread: MessagePort = parent;

const service = input.service;
process.on("uncaughtException", (error) => {
  console.error(`${service} worker error: ${error.message}`);
});
process.on("unhandledRejection", (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${service} worker rejection: ${message}`);
});

const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let nextRequestId = 1;
const servers: Server[] = [];
const listenerStatus: ListenerStatus[] = [];
let queueTimer: ReturnType<typeof setInterval> | undefined;
let resolveListeners = (): void => undefined;
const listenersApplied = new Promise<void>((resolve) => {
  resolveListeners = resolve;
});

function askParent<T>(message: Record<string, unknown>): Promise<T> {
  const requestId = nextRequestId;
  nextRequestId += 1;
  return new Promise((resolve, reject) => {
    pending.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject
    });
    thread.postMessage({ ...message, requestId });
  });
}

async function remember(
  description: Omit<ListenerStatus, "started" | "detail" | "port"> & { port: number },
  starter: () => Promise<{ server: Server; port: number }>
): Promise<void> {
  try {
    const started = await starter();
    servers.push(started.server);
    listenerStatus.push({ ...description, port: started.port, started: true, detail: "" });
  } catch (error) {
    listenerStatus.push({ ...description, started: false, detail: describeListenError(error as NodeJS.ErrnoException) });
  }
}

async function closeServers(): Promise<void> {
  if (queueTimer) {
    clearInterval(queueTimer);
  }
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

async function startService(runtime: MailRuntime): Promise<void> {
  const shared = {
    configuration: runtime.configuration,
    certificate: runtime.certificate,
    accountRepository: runtime.accountRepository,
    signInGuard: runtime.signInGuard,
    activityLogger: runtime.activityLogger
  };
  if (service === ServiceName.Smtp) {
    await remember({ name: "SMTP", port: runtime.configuration.smtpPort, security: "Plain and STARTTLS", purpose: "Receive mail" }, () =>
      new SmtpServer({
        ...shared,
        endpoint: { port: runtime.configuration.smtpPort, secure: false, requireAuthentication: false },
        deliveryService: runtime.deliveryService,
        serverName: runtime.serverName
      }).start()
    );
    await remember({ name: "SMTP", port: runtime.configuration.smtpSecurePort, security: "TLS", purpose: "Send mail" }, () =>
      new SmtpServer({
        ...shared,
        endpoint: { port: runtime.configuration.smtpSecurePort, secure: true, requireAuthentication: true },
        deliveryService: runtime.deliveryService,
        serverName: runtime.serverName
      }).start()
    );
    await remember({ name: "SMTP", port: runtime.configuration.smtpSubmissionPort, security: "STARTTLS", purpose: "Send mail" }, () =>
      new SmtpServer({
        ...shared,
        endpoint: { port: runtime.configuration.smtpSubmissionPort, secure: false, requireAuthentication: true },
        deliveryService: runtime.deliveryService,
        serverName: runtime.serverName
      }).start()
    );
    return;
  }
  if (service === ServiceName.Imap) {
    await remember({ name: "IMAP", port: runtime.configuration.imapPort, security: "Plain and STARTTLS", purpose: "Read mail" }, () =>
      new ImapServer({ ...shared, port: runtime.configuration.imapPort, secure: false, messageRepository: runtime.messageRepository, mailboxEvents: runtime.mailboxEvents }).start()
    );
    await remember({ name: "IMAP", port: runtime.configuration.imapSecurePort, security: "TLS", purpose: "Read mail" }, () =>
      new ImapServer({ ...shared, port: runtime.configuration.imapSecurePort, secure: true, messageRepository: runtime.messageRepository, mailboxEvents: runtime.mailboxEvents }).start()
    );
    return;
  }
  if (service === ServiceName.Pop3) {
    await remember({ name: "POP3", port: runtime.configuration.pop3Port, security: "Plain and STLS", purpose: "Read mail" }, () =>
      new Pop3Server({ ...shared, port: runtime.configuration.pop3Port, secure: false, messageRepository: runtime.messageRepository }).start()
    );
    await remember({ name: "POP3", port: runtime.configuration.pop3SecurePort, security: "TLS", purpose: "Read mail" }, () =>
      new Pop3Server({ ...shared, port: runtime.configuration.pop3SecurePort, secure: true, messageRepository: runtime.messageRepository }).start()
    );
    return;
  }
  if (service === ServiceName.Web) {
    const webServer = createWebServer({
      configuration: runtime.configuration,
      accountRepository: runtime.accountRepository,
      organizationRepository: runtime.organizationRepository,
      messageRepository: runtime.messageRepository,
      mailboxEvents: runtime.mailboxEvents,
      sessionRepository: runtime.sessionRepository,
      activityLogger: runtime.activityLogger,
      deliveryService: runtime.deliveryService,
      signInGuard: runtime.signInGuard,
      listenerStatus,
      certificate: runtime.certificate,
      serverName: runtime.serverName,
      settingsRepository: runtime.settingsRepository,
      readCertificate: async () => describeCertificateMaterial(runtime.certificate.certificate, runtime.certificate.privateKey),
      async replaceCertificate(certificatePem, privateKeyPem, intermediateCertificatesPem = "") {
        const prepared = prepareCertificateMaterial(certificatePem, privateKeyPem, intermediateCertificatesPem);
        const description = await storeCertificateMaterial(runtime.configuration.storageDirectory, certificatePem, privateKeyPem, intermediateCertificatesPem);
        runtime.certificate.privateKey = prepared.privateKey;
        runtime.certificate.certificate = prepared.certificate;
        applyCertificate(runtime.certificate, servers);
        publishCertificateReplacement();
        return description;
      }
    });
    await remember(
      {
        name: "Web",
        port: runtime.configuration.webPort,
        security: runtime.configuration.secureWeb ? "HTTPS" : "HTTP",
        purpose: "Administrator and mailbox"
      },
      async () => {
        const port = await startWebServer(webServer, runtime.configuration.webPort, runtime.configuration.host);
        return { server: webServer, port };
      }
    );
    return;
  }
  if (service === ServiceName.Queue) {
    queueTimer = setInterval(() => {
      runtime.deliveryService.processQueue().catch((error: Error) => {
        console.error(`Outbound queue failed: ${error.message}`);
      });
    }, 30 * 1000);
  }
}

thread.on("message", (message: WorkerMessage) => {
  if (message.kind === WorkerMessageKind.ParentResponse) {
    const response = message as ParentResponse;
    const waiter = pending.get(response.requestId);
    if (!waiter) {
      return;
    }
    pending.delete(response.requestId);
    if (response.error) {
      waiter.reject(new Error(response.error));
      return;
    }
    waiter.resolve(response.records);
    return;
  }
  if (message.kind === WorkerMessageKind.Listeners && Array.isArray(message.listeners)) {
    listenerStatus.splice(0, listenerStatus.length, ...message.listeners);
    resolveListeners();
    return;
  }
  if (message.kind === WorkerMessageKind.Stop) {
    void closeServers().then(() => process.exit(0));
  }
});

try {
  const runtime = await createMailRuntime({
    configuration: input.configuration,
    mailExchangeResolver: {
      resolve(domain: string) {
        return askParent<MailExchange[]>({ kind: WorkerMessageKind.ResolveMailExchange, domain });
      }
    }
  });
  followCertificateReplacement(runtime.configuration.storageDirectory, runtime.certificate, () => servers);
  await startService(runtime);
  thread.postMessage({ kind: WorkerMessageKind.Listening, service, listeners: listenerStatus });
  if (service === ServiceName.Web) {
    await listenersApplied;
  }
  thread.postMessage({ kind: WorkerMessageKind.Ready, service });
} catch (error) {
  thread.postMessage({ kind: WorkerMessageKind.Failed, service, detail: (error as Error).message });
  process.exit(1);
}
