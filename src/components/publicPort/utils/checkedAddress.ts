import net from "node:net";

export function isLiteralAddress(hostname: string): boolean {
  return net.isIP(hostname) !== 0;
}

export function isPublicInternetAddress(address: string): boolean {
  if (net.isIP(address) === 4) {
    return isPublicInternetVersion4Address(address);
  }
  if (net.isIP(address) === 6) {
    return isPublicInternetVersion6Address(address);
  }
  return false;
}

export function assertPublicAddress(value: string): string {
  const address = value.trim();
  if (!address) {
    throw Object.assign(new Error("Enter the public IP address of this server."), { statusCode: 400 });
  }
  if (net.isIP(address) === 4 && isPublicInternetVersion4Address(address)) {
    return address;
  }
  if (net.isIP(address) === 6 && isPublicInternetVersion6Address(address)) {
    return address.toLowerCase();
  }
  throw Object.assign(new Error("Enter the public IP address of this server. A private or local address cannot be published in DNS."), { statusCode: 400 });
}

function isPublicInternetVersion4Address(address: string): boolean {
  if (!isDottedAddress(address)) {
    return false;
  }
  const [firstOctet, secondOctet] = address.split(".").map((part) => Number(part));
  if (firstOctet === 0 || firstOctet === 10 || firstOctet === 127 || firstOctet >= 224) {
    return false;
  }
  if (firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127) {
    return false;
  }
  if (firstOctet === 169 && secondOctet === 254) {
    return false;
  }
  if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) {
    return false;
  }
  if (firstOctet === 192 && secondOctet === 168) {
    return false;
  }
  return true;
}

function isPublicInternetVersion6Address(address: string): boolean {
  if (address.includes("%") || address.includes(".")) {
    return false;
  }
  const groups = internetVersion6Groups(address.toLowerCase());
  if (!groups) {
    return false;
  }
  const firstGroup = groups[0];
  const unspecified = groups.every((group) => group === 0);
  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const linkLocal = (firstGroup & 0xffc0) === 0xfe80;
  const uniqueLocal = (firstGroup & 0xfe00) === 0xfc00;
  const multicast = (firstGroup & 0xff00) === 0xff00;
  const documentation = firstGroup === 0x2001 && groups[1] === 0x0db8;
  const mappedVersion4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  return !unspecified && !loopback && !linkLocal && !uniqueLocal && !multicast && !documentation && !mappedVersion4;
}

function internetVersion6Groups(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) {
    return null;
  }
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1) || (halves.length === 1 && missing !== 0)) {
    return null;
  }
  const filled = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (filled.length !== 8 || filled.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }
  return filled.map((group) => Number.parseInt(group, 16));
}

function isDottedAddress(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && !(part.length > 1 && part.startsWith("0")));
}
