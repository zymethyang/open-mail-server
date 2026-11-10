import type { StartupBanner } from "../interfaces/startupBanner.js";
import { formatDnsGuideForTerminal } from "../../web/utils/dnsGuide.js";

export function startupBanner(input: StartupBanner): string {
  const lines = ["", "Open Mail Server", `Storage  ${input.storageDirectory}`];
  for (const listener of input.listeners) {
    const state = listener.started ? "ready" : `unavailable (${listener.detail})`;
    const webScheme = listener.security === "HTTPS" ? "https" : "http";
    const location = listener.name === "Web" ? `${webScheme}://${input.connectionHost}:${listener.port}` : `${input.connectionHost}:${listener.port}`;
    lines.push(`${listener.name.padEnd(6)} ${location.padEnd(28)} ${listener.security.padEnd(22)} ${listener.purpose.padEnd(28)} ${state}`);
  }
  const webListener = input.listeners.find((listener) => listener.started && listener.name === "Web");
  if (webListener && input.publishNetworkAddresses) {
    const scheme = webListener.security === "HTTPS" ? "https" : "http";
    for (const address of input.networkAddresses) {
      lines.push(`Other computers on this network can open ${scheme}://${address}:${webListener.port}`);
    }
  }
  lines.push("");
  if (input.dnsGuide) {
    lines.push(formatDnsGuideForTerminal(input.dnsGuide.domain, input.dnsGuide.zoneFile));
  } else {
    lines.push("Open the web console and create the company. The domain is chosen on that page.");
  }
  lines.push("The public name and relay are changed in Settings. The web console uses the certificate stored with the mail data. The bind address and protocol ports stay on the built-in defaults.");
  lines.push("Messages are encrypted in the storage directory. Keep the storage-key file with that directory. Docker mounts the storage directory from the host.");
  lines.push("");
  return lines.join("\n");
}
