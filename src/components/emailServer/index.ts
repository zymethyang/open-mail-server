import { Worker } from "node:worker_threads";
import type { Configuration } from "../configuration/index.js";
import { configurationWithListeners, loadConfiguration } from "../configuration/index.js";
import type { MailExchange, MailExchangeResolver } from "../mailExchange/interfaces/mailExchange.js";
import { DnsMailExchangeResolver } from "../mailExchange/index.js";
import { openSecureStorage } from "../secureStorage/index.js";
import { SettingsRepository } from "../settings/index.js";
import type { ListenerStatus } from "../web/interfaces/listenerStatus.js";
import { ensureMailCertificate } from "./mailRuntime.js";
import { serviceNames, ServiceName } from "./serviceNames.js";
import { WorkerMessageKind } from "./enums/workerMessageKind.js";
import type { WorkerMessage } from "./interfaces/workerMessage.js";
import type { RunningEmailServer } from "./interfaces/runningEmailServer.js";
export type { RunningEmailServer };

export async function startEmailServer(options?: {
  configuration?: Configuration;
  mailExchangeResolver?: MailExchangeResolver;
}): Promise<RunningEmailServer> {
  const configuration = await resolveConfiguration(options);
  await ensureMailCertificate(configuration);
  const mailExchangeResolver = options?.mailExchangeResolver || new DnsMailExchangeResolver();
  const listeners: ListenerStatus[] = [];
  const workers = new Map<ServiceName, Worker>();
  const runningWorkers = new Set<Worker>();
  const reported = new Map<ServiceName, ListenerStatus[]>();
  const ready = new Set<ServiceName>();
  let stopping = false;
  let acceptRestart = false;
  let resolveStartup = (): void => undefined;
  let rejectStartup = (_error: Error): void => undefined;
  const startup = new Promise<void>((resolve, reject) => {
    resolveStartup = resolve;
    rejectStartup = reject;
  });
  const startupTimer = setTimeout(() => {
    failStartup(new Error("The mail services did not start"));
  }, 20_000);

  function failStartup(error: Error): void {
    if (acceptRestart || stopping) {
      return;
    }
    stopping = true;
    clearTimeout(startupTimer);
    rejectStartup(error);
    for (const worker of workers.values()) {
      void worker.terminate();
    }
  }

  function publishListeners(): void {
    const next = serviceNames.flatMap((service) => reported.get(service) || []);
    listeners.splice(0, listeners.length, ...next);
    const webWorker = workers.get(ServiceName.Web);
    if (webWorker && runningWorkers.has(webWorker)) {
      webWorker.postMessage({ kind: WorkerMessageKind.Listeners, listeners: next });
    }
  }

  function handleMessage(service: ServiceName, worker: Worker, message: WorkerMessage): void {
    if (workers.get(service) !== worker) {
      return;
    }
    if (message.kind === WorkerMessageKind.ResolveMailExchange && message.requestId && message.domain) {
      void mailExchangeResolver.resolve(message.domain).then(
        (records: MailExchange[]) => {
          if (workers.get(service) === worker) {
            worker.postMessage({ kind: WorkerMessageKind.ParentResponse, requestId: message.requestId, records });
          }
        },
        (error: Error) => {
          if (workers.get(service) === worker) {
            worker.postMessage({ kind: WorkerMessageKind.ParentResponse, requestId: message.requestId, error: error.message });
          }
        }
      );
      return;
    }
    if (message.kind === WorkerMessageKind.Failed) {
      failStartup(new Error(message.detail || `${service} failed to start`));
      return;
    }
    if (message.kind === WorkerMessageKind.Listening) {
      reported.set(service, message.listeners || []);
      if (reported.size === serviceNames.length) {
        publishListeners();
      }
      return;
    }
    if (message.kind === WorkerMessageKind.Ready) {
      ready.add(service);
      if (!acceptRestart && ready.size === serviceNames.length) {
        acceptRestart = true;
        clearTimeout(startupTimer);
        resolveStartup();
      }
    }
  }

  function spawn(service: ServiceName): void {
    const worker = new Worker(new URL("./serviceWorker.js", import.meta.url), {
      workerData: { service, configuration }
    });
    workers.set(service, worker);
    runningWorkers.add(worker);
    worker.on("message", (message: WorkerMessage) => handleMessage(service, worker, message));
    worker.on("error", (error) => {
      console.error(`${service} worker error: ${error.message}`);
      if (!acceptRestart) {
        failStartup(error);
      }
    });
    worker.on("exit", (code) => {
      runningWorkers.delete(worker);
      if (stopping || workers.get(service) !== worker) {
        return;
      }
      if (!acceptRestart) {
        failStartup(new Error(`${service} worker stopped before it was ready`));
        return;
      }
      console.error(`${service} worker stopped (${code}). Starting it again.`);
      ready.delete(service);
      setTimeout(() => {
        if (!stopping) {
          spawn(service);
        }
      }, 300);
    });
  }

  for (const service of serviceNames) {
    spawn(service);
  }
  try {
    await startup;
  } catch (error) {
    stopping = true;
    await Promise.all([...workers.values()].map((worker) => worker.terminate()));
    throw error;
  }

  return {
    configuration,
    listeners,
    async stop() {
      stopping = true;
      clearTimeout(startupTimer);
      await Promise.all(
        [...workers.values()].map(
          (worker) =>
            new Promise<void>((resolve) => {
              if (!runningWorkers.has(worker)) {
                resolve();
                return;
              }
              const timer = setTimeout(() => {
                void worker.terminate().finally(() => resolve());
              }, 5_000);
              worker.once("exit", () => {
                clearTimeout(timer);
                resolve();
              });
              worker.postMessage({ kind: WorkerMessageKind.Stop });
            })
        )
      );
    }
  };
}

async function resolveConfiguration(options?: { configuration?: Configuration }): Promise<Configuration> {
  const baseConfiguration = options?.configuration || loadConfiguration();
  await openSecureStorage(baseConfiguration.storageDirectory);
  if (options?.configuration) {
    return options.configuration;
  }
  const storedSettings = await new SettingsRepository(baseConfiguration.storageDirectory, baseConfiguration.maximumMessageBytes).read();
  if (!storedSettings.listenersSaved) {
    return baseConfiguration;
  }
  return configurationWithListeners(baseConfiguration, storedSettings.listeners);
}
