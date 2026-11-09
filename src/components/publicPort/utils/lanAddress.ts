import os from "node:os";

export function lanAddressFromRoute(
  routedAddress: string,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): string {
  const routed = routedAddress.trim();
  if (isUsableAddress(routed) && networkCardHasAddress(interfaces, routed)) {
    return routed;
  }
  const addresses = usableAddresses(interfaces);
  addresses.sort();
  return addresses[0] || "";
}

function networkCardHasAddress(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>, address: string): boolean {
  return usableAddresses(interfaces).includes(address);
}

function usableAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      const family = String(entry.family);
      if ((family !== "IPv4" && family !== "4") || entry.internal || !isUsableAddress(entry.address)) {
        continue;
      }
      addresses.push(entry.address);
    }
  }
  return addresses;
}

function isUsableAddress(address: string): boolean {
  if (!isDottedAddress(address) || address === "0.0.0.0" || address.startsWith("127.")) {
    return false;
  }
  const [firstOctet, secondOctet] = address.split(".").map((part) => Number(part));
  return !(firstOctet === 169 && secondOctet === 254);
}

function isDottedAddress(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && !(part.length > 1 && part.startsWith("0")));
}
