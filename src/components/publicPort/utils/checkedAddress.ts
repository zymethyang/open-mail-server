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
  networkAddress: string;
}): { address: string; source: string } {
  const hostname = input.hostname.trim().toLowerCase();
  const resolvedAddress = isPublicInternetAddress(input.resolvedAddress.trim()) ? input.resolvedAddress.trim() : "";
  const networkAddress = isPublicInternetAddress(input.networkAddress.trim()) ? input.networkAddress.trim() : "";
  const localName = !hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".test");

  if (isLiteralAddress(hostname)) {
    return { address: hostname, source: "configured address" };
  }
  if (networkAddress && resolvedAddress === networkAddress) {
    return { address: networkAddress, source: `address record for ${hostname}` };
  }
  if (networkAddress && resolvedAddress && resolvedAddress !== networkAddress) {
    return {
      address: networkAddress,
      source: `${hostname} points at ${resolvedAddress}. The public address on this machine's network card is ${networkAddress}`
    };
  }
  if (networkAddress) {
    return { address: networkAddress, source: "public address on a network card" };
  }
  if (localName) {
    return {
      address: "",
      source: `${hostname || "This name"} is not a public hostname, and no network card has a public address.`
    };
  }
  return { address: "", source: "No network card on this server has a public address." };
}

function isDottedAddress(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && !(part.length > 1 && part.startsWith("0")));
}
