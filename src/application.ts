import { startEmailServer } from "./components/emailServer/index.js";

const running = await startEmailServer();
const started = running.listeners.filter((listener) => listener.started);
if (!started.length) {
  console.error("No listeners started.");
  process.exit(1);
}

const connectionHost =
  running.configuration.host === "0.0.0.0" || running.configuration.host === "::" ? "127.0.0.1" : running.configuration.host;
console.log("");
console.log(running.configuration.productName);
console.log(`Storage  ${running.configuration.storageDirectory}`);
for (const listener of running.listeners) {
  const state = listener.started ? "ready" : `unavailable (${listener.detail})`;
  const webScheme = listener.security === "HTTPS" ? "https" : "http";
  const location = listener.name === "Web" ? `${webScheme}://${connectionHost}:${listener.port}` : `${connectionHost}:${listener.port}`;
  console.log(`${listener.name.padEnd(6)} ${location.padEnd(28)} ${listener.security.padEnd(22)} ${listener.purpose.padEnd(28)} ${state}`);
}
console.log("");
console.log("Open the web console and create the company. The domain is chosen on that page.");
console.log("The public name, relay, and web security are changed in Settings. The bind address and protocol ports stay on the built-in defaults.");
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
