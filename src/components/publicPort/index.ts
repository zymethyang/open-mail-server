import dgram from "node:dgram";
import { promises as dns } from "node:dns";
import net from "node:net";
import os from "node:os";
import { PortReachabilityResult } from "./enums/portReachabilityResult.js";
import type { PortReachability, PublicReachability } from "./interfaces/publicReachability.js";
import { chooseCheckedAddress, isLiteralAddress, isPublicInternetAddress } from "./utils/checkedAddress.js";
import { lanAddressFromRoute } from "./utils/lanAddress.js";

export type { PortReachability, PublicReachability };

const cache = new Map<string, { expiresAt: number; value: PublicReachability }>();
const lookupLimitMilliseconds = 8000;

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

export async function addressForDnsRecords(discoveredAddress: string): Promise<string> {
  const discovered = discoveredAddress.trim();
  if (isPublicInternetAddress(discovered)) {
    return discovered;
  }
  return lanAddressFromRoute(await routedLocalAddress());
}

function routedLocalAddress(): Promise<string> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4" });
    let settled = false;
    const finish = (address: string) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.close();
      resolve(address);
    };
    socket.once("error", () => finish(""));
    socket.connect(9, "192.0.2.1", () => {
      const address = socket.address();
      finish(typeof address === "string" ? "" : address.address);
    });
  });
}

export function publicAddressFromNetworkCards(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string {
  const addresses: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      const family = String(entry.family);
      if ((family !== "IPv4" && family !== "4") || entry.internal || !isPublicInternetAddress(entry.address)) {
        continue;
      }
      addresses.push(entry.address);
    }
  }
  addresses.sort();
  return addresses[0] || "";
}

export async function locatePublicAddress(hostname: string): Promise<{ address: string; source: string }> {
  const normalized = hostname.trim().toLowerCase();
  if (isLiteralAddress(normalized)) {
    return { address: normalized, source: "configured address" };
  }
  const localName = !normalized || normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".test");
  const networkAddress = publicAddressFromNetworkCards();
  const resolvedAddress = localName ? "" : await resolveAddress(normalized);
  return chooseCheckedAddress({
    hostname: normalized,
    resolvedAddress,
    networkAddress
  });
}

async function resolveAddress(hostname: string): Promise<string> {
  const fromRecord = await withTimeout(
    dns.resolve4(hostname).then(
      (addresses) => addresses.find((address) => isPublicInternetAddress(address)) || "",
      () => ""
    ),
    lookupLimitMilliseconds,
    ""
  );
  if (fromRecord) {
    return fromRecord;
  }
  return withTimeout(
    dns.lookup(hostname, { family: 4 }).then(
      (result) => (isPublicInternetAddress(result.address) ? result.address : ""),
      () => ""
    ),
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
