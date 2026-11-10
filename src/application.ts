import os from "node:os";
import { startEmailServer } from "./components/emailServer/index.js";
import { startupBanner } from "./components/emailServer/utils/startupBanner.js";
import { readStoredDnsGuide } from "./components/web/utils/startupDnsGuide.js";

function networkAddresses(): string[] {
  const addresses: string[] = [];
  for (const records of Object.values(os.networkInterfaces())) {
    for (const record of records || []) {
      const family = String(record.family);
      const linkLocal = record.address.startsWith("169.254.");
      if ((family !== "IPv4" && family !== "4") || record.internal || linkLocal || addresses.includes(record.address)) {
        continue;
      }
      addresses.push(record.address);
    }
  }
  return addresses;
}

const running = await startEmailServer();
const started = running.listeners.filter((listener) => listener.started);
if (!started.length) {
  console.error("No listeners started.");
  for (const listener of running.listeners) {
    console.error(`${listener.name} on port ${listener.port} did not start: ${listener.detail}`);
  }
  process.exit(1);
}

const connectionHost =
  running.configuration.host === "0.0.0.0" || running.configuration.host === "::" ? "127.0.0.1" : running.configuration.host;
const dnsGuide = await readStoredDnsGuide(running.configuration);
console.log(startupBanner({
  storageDirectory: running.configuration.storageDirectory,
  connectionHost,
  listeners: running.listeners,
  networkAddresses: networkAddresses(),
  publishNetworkAddresses: running.configuration.host === "0.0.0.0" || running.configuration.host === "::",
  dnsGuide
}));

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  await running.stop();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
