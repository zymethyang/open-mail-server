import os from "node:os";
import { startEmailServer } from "./components/emailServer/index.js";

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
console.log("");
console.log("Open Mail Server");
console.log(`Storage  ${running.configuration.storageDirectory}`);
for (const listener of running.listeners) {
  const state = listener.started ? "ready" : `unavailable (${listener.detail})`;
  const webScheme = listener.security === "HTTPS" ? "https" : "http";
  const location = listener.name === "Web" ? `${webScheme}://${connectionHost}:${listener.port}` : `${connectionHost}:${listener.port}`;
  console.log(`${listener.name.padEnd(6)} ${location.padEnd(28)} ${listener.security.padEnd(22)} ${listener.purpose.padEnd(28)} ${state}`);
}
const webListener = started.find((listener) => listener.name === "Web");
if (webListener && (running.configuration.host === "0.0.0.0" || running.configuration.host === "::")) {
  const scheme = webListener.security === "HTTPS" ? "https" : "http";
  for (const address of networkAddresses()) {
    console.log(`Other computers on this network can open ${scheme}://${address}:${webListener.port}`);
  }
}
console.log("");
console.log("Open the web console and create the company. The domain is chosen on that page.");
console.log("The public name and relay are changed in Settings. The web console uses the certificate stored with the mail data. The bind address and protocol ports stay on the built-in defaults.");
console.log("Messages are encrypted in the storage directory. Keep the storage-key file with that directory. Docker mounts the storage directory from the host.");
console.log("");

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
