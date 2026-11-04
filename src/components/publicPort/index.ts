import { Resolver } from "node:dns";
import { promises as dns } from "node:dns";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import { PortReachabilityResult } from "./enums/portReachabilityResult.js";
import type { PortReachability, PublicReachability } from "./interfaces/publicReachability.js";
import { chooseCheckedAddress, isLiteralAddress, isPublicInternetAddress } from "./utils/checkedAddress.js";

export type { PortReachability, PublicReachability };

const cache = new Map<string, { expiresAt: number; value: PublicReachability }>();
const lookupLimitMilliseconds = 3000;
const publicAddressServices = ["https://checkip.amazonaws.com/", "https://api.ipify.org/"];

export async function checkPublicPorts(hostname: string, ports: number[], listenHost = ""): Promise<PublicReachability> {
  const uniquePorts = [...new Set(ports.filter((port) => port > 0 && port <= 65535))].sort((left, right) => left - right);
  const key = `${listenHost}|${hostname}|${uniquePorts.join(",")}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const value = listensOnlyOnLoopback(listenHost)
    ? loopbackReachability(listenHost, uniquePorts)
    : await probePublicPorts(hostname, uniquePorts);
  cache.set(key, { expiresAt: Date.now() + 30 * 1000, value });
  return value;
}

async function probePublicPorts(hostname: string, ports: number[]): Promise<PublicReachability> {
  const located = await locatePublicAddress(hostname);
  const checks = located.address
    ? await Promise.all(ports.map((port) => probePort(located.address, port)))
    : ports.map((port) => ({ port, result: PortReachabilityResult.Unknown, detail: "No public address" }));
  return { address: located.address, source: located.source, checks };
}

function loopbackReachability(listenHost: string, ports: number[]): PublicReachability {
  const detail = `Listening on ${listenHost.trim()} only. The public network cannot connect.`;
  return {
    address: "",
    source: detail,
    checks: ports.map((port) => ({ port, result: PortReachabilityResult.Closed, detail }))
  };
}

function listensOnlyOnLoopback(listenHost: string): boolean {
  const normalized = listenHost.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost" || normalized === "::ffff:127.0.0.1";
}

async function locatePublicAddress(hostname: string): Promise<{ address: string; source: string }> {
  const normalized = hostname.trim().toLowerCase();
  if (isLiteralAddress(normalized)) {
    return { address: normalized, source: "configured address" };
  }
  const localName = !normalized || normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".test");
  const [resolvedAddress, discoveredAddress] = await Promise.all([
    localName ? Promise.resolve("") : resolveAddress(normalized),
    discoverPublicAddress()
  ]);
  return chooseCheckedAddress({
    hostname: normalized,
    resolvedAddress,
    discoveredAddress,
    localAddresses: machineAddresses()
  });
}

async function resolveAddress(hostname: string): Promise<string> {
  try {
    const addresses = await dns.resolve4(hostname);
    return addresses.find((address) => isPublicInternetAddress(address)) || addresses[0] || "";
  } catch {
    return "";
  }
}

async function discoverPublicAddress(): Promise<string> {
  const [firstService, secondService, googleAddress] = await Promise.all([
    readRemoteText(publicAddressServices[0]),
    readRemoteText(publicAddressServices[1]),
    readGooglePublicAddress()
  ]);
  const firstAddress = internetAddressFromText(firstService);
  const secondAddress = internetAddressFromText(secondService);
  if (firstAddress && (!secondAddress || firstAddress === secondAddress)) {
    return firstAddress;
  }
  if (secondAddress) {
    return secondAddress;
  }
  return internetAddressFromText(googleAddress);
}

function internetAddressFromText(value: string): string {
  const match = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  return match && isPublicInternetAddress(match[0]) ? match[0] : "";
}

function readRemoteText(url: string): Promise<string> {
  return withTimeout(
    new Promise((resolve) => {
      const request = https.get(url, { family: 4, timeout: lookupLimitMilliseconds, headers: { "User-Agent": "Email Server" } }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          resolve("");
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        response.on("error", () => resolve(""));
      });
      request.on("error", () => resolve(""));
      request.on("timeout", () => {
        request.destroy();
        resolve("");
      });
    }),
    lookupLimitMilliseconds,
    ""
  );
}

function readGooglePublicAddress(): Promise<string> {
  const resolver = new Resolver();
  resolver.setServers(["8.8.8.8"]);
  return withTimeout(
    new Promise((resolve) => {
      resolver.resolveTxt("o-o.myaddr.l.google.com", (error, records) => {
        resolve(error ? "" : records.flat().join(""));
      });
    }),
    lookupLimitMilliseconds,
    ""
  );
}

function withTimeout<T>(work: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), milliseconds);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

function machineAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.address) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function probePort(address: string, port: number): Promise<PortReachability> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: address, port });
    let settled = false;
    const finish = (result: PortReachability["result"], detail: string) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({ port, result, detail });
    };
    socket.setTimeout(1500, () => finish(PortReachabilityResult.Closed, "Timed out. The firewall may be filtering this port."));
    socket.once("connect", () => finish(PortReachabilityResult.Open, "Accepted a connection"));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED") {
        finish(PortReachabilityResult.Closed, "Connection refused");
        return;
      }
      finish(PortReachabilityResult.Closed, error.message || "Connection failed");
    });
  });
}
