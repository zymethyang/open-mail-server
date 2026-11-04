export function isLiteralAddress(hostname: string): boolean {
  return isDottedAddress(hostname) || hostname.includes(":");
}

export function isPublicInternetAddress(address: string): boolean {
  if (!isDottedAddress(address)) {
    return false;
  }
  const [firstOctet, secondOctet, thirdOctet] = address.split(".").map((part) => Number(part));
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
  if (firstOctet === 192 && secondOctet === 0 && thirdOctet === 2) {
    return false;
  }
  if (firstOctet === 198 && secondOctet === 51 && thirdOctet === 100) {
    return false;
  }
  if (firstOctet === 203 && secondOctet === 113) {
    return false;
  }
  return true;
}

export function chooseCheckedAddress(input: {
  hostname: string;
  resolvedAddress: string;
  discoveredAddress: string;
  localAddresses: readonly string[];
}): { address: string; source: string } {
  const hostname = input.hostname.trim().toLowerCase();
  const resolvedAddress = input.resolvedAddress.trim();
  const discoveredAddress = isPublicInternetAddress(input.discoveredAddress.trim()) ? input.discoveredAddress.trim() : "";
  const localAddresses = new Set(input.localAddresses.map((address) => address.trim().toLowerCase()));
  const localName = !hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".test");

  if (isLiteralAddress(hostname)) {
    return { address: hostname, source: "configured address" };
  }
  if (resolvedAddress && isPublicInternetAddress(resolvedAddress) && (resolvedAddress === discoveredAddress || localAddresses.has(resolvedAddress))) {
    return { address: resolvedAddress, source: `address record for ${hostname}` };
  }
  if (discoveredAddress) {
    if (!localName && resolvedAddress && localAddresses.has(resolvedAddress)) {
      return {
        address: discoveredAddress,
        source: `${hostname} points at ${resolvedAddress} on this machine. This is the public address seen from the internet`
      };
    }
    if (!localName && resolvedAddress && resolvedAddress !== discoveredAddress) {
      return {
        address: discoveredAddress,
        source: `${hostname} points at ${resolvedAddress}, which is not this server. This is the public address seen from the internet`
      };
    }
    return { address: discoveredAddress, source: "public address seen from the internet" };
  }
  if (!localName && resolvedAddress) {
    return { address: resolvedAddress, source: `address record for ${hostname}` };
  }
  if (localName) {
    return {
      address: "",
      source: `${hostname || "This name"} is not a public hostname, and the public address lookup did not answer.`
    };
  }
  return { address: "", source: "The public address lookup did not return an address." };
}

function isDottedAddress(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && !(part.length > 1 && part.startsWith("0")));
}
