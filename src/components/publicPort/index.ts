import net from "node:net";
import { PortReachabilityResult } from "./enums/portReachabilityResult.js";
import type { PortReachability, PublicReachability } from "./interfaces/publicReachability.js";
import { isLiteralAddress, isPublicInternetAddress } from "./utils/checkedAddress.js";

export type { PortReachability, PublicReachability };

const cache = new Map<string, { expiresAt: number; value: PublicReachability }>();

export function checkedAddressReport(address: string): { address: string; source: string } {
  const trimmed = address.trim();
  if (!isLiteralAddress(trimmed)) {
    return { address: "", source: "No public IP address has been entered." };
  }
  if (isPublicInternetAddress(trimmed)) {
    return { address: trimmed, source: "public IP address entered for this server" };
  }
  return { address: trimmed, source: "configured address" };
}

export async function checkPublicPorts(publicAddress: string, ports: number[], listenHost = ""): Promise<PublicReachability> {
  const uniquePorts = [...new Set(ports.filter((port) => port > 0 && port <= 65535))].sort((left, right) => left - right);
  const located = checkedAddressReport(publicAddress);
  const key = `${listenHost}|${located.address}|${located.source}|${uniquePorts.join(",")}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const value = listensOnlyOnLoopback(listenHost)
    ? loopbackReachability(listenHost, uniquePorts)
    : await probePublicPorts(located, uniquePorts);
  cache.set(key, { expiresAt: Date.now() + 30 * 1000, value });
  return value;
}

async function probePublicPorts(located: { address: string; source: string }, ports: number[]): Promise<PublicReachability> {
  if (!located.address) {
    return {
      address: "",
      source: located.source,
      checks: ports.map((port) => ({ port, result: PortReachabilityResult.Unknown, detail: "No public IP address" }))
    };
  }
  const checks = await Promise.all(ports.map((port) => probePort(located.address, port)));
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
