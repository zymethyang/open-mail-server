import { readFile } from "node:fs/promises";
import path from "node:path";
import type net from "node:net";
import tls from "node:tls";
import type { ServerCertificate } from "./interfaces/serverCertificate.js";
import { secureOptions } from "../protocol/utils/transportSecurity.js";

const channel = new BroadcastChannel("email-server-certificate");
(channel as BroadcastChannel & { unref(): void }).unref();

export function publishCertificateReplacement(): void {
  channel.postMessage({ kind: "replaced" });
}

export function followCertificateReplacement(
  storageDirectory: string,
  certificate: ServerCertificate,
  servers: () => net.Server[]
): void {
  channel.addEventListener("message", () => {
    void reloadCertificate(storageDirectory, certificate, servers);
  });
}

export function applyCertificate(certificate: ServerCertificate, servers: net.Server[]): void {
  const options = secureOptions(certificate);
  for (const server of servers) {
    const secureServer = server as tls.Server;
    if (typeof secureServer.setSecureContext === "function") {
      secureServer.setSecureContext(options);
    }
  }
}

async function reloadCertificate(storageDirectory: string, certificate: ServerCertificate, servers: () => net.Server[]): Promise<void> {
  try {
    const directory = path.join(storageDirectory, "certificates");
    const [privateKey, nextCertificate] = await Promise.all([
      readFile(path.join(directory, "private-key.pem"), "utf8"),
      readFile(path.join(directory, "certificate.pem"), "utf8")
    ]);
    certificate.privateKey = privateKey;
    certificate.certificate = nextCertificate;
    applyCertificate(certificate, servers());
  } catch (error) {
    console.error(`Certificate reload failed: ${(error as Error).message}`);
  }
}
