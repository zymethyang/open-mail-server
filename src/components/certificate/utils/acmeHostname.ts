function isInternetProtocolAddress(value: string): boolean {
  const octets = value.split(".");
  if (octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) {
    return true;
  }
  return value.includes(":");
}

export function assertAcmeHostname(hostname: string): string {
  const trimmed = String(hostname || "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  if (!trimmed) {
    throw Object.assign(new Error("Set a public hostname or company domain before requesting Let’s Encrypt"), { statusCode: 400 });
  }
  if (trimmed === "localhost" || trimmed.endsWith(".localhost") || trimmed === "127.0.0.1" || trimmed === "::1" || trimmed === "[::1]") {
    throw Object.assign(new Error("Let’s Encrypt cannot issue a certificate for localhost or loopback addresses"), { statusCode: 400 });
  }
  if (isInternetProtocolAddress(trimmed)) {
    throw Object.assign(new Error("Let’s Encrypt HTTP-01 needs a DNS hostname, not an IP address"), { statusCode: 400 });
  }
  if (trimmed.endsWith(".test") || trimmed.endsWith(".invalid") || trimmed.endsWith(".example") || trimmed.endsWith(".local")) {
    throw Object.assign(new Error("Let’s Encrypt cannot issue a certificate for local or reserved test domains"), { statusCode: 400 });
  }
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(trimmed)) {
    throw Object.assign(new Error("That hostname is not valid for Let’s Encrypt"), { statusCode: 400 });
  }
  return trimmed;
}

export function assertAcmeContactEmail(email: string): string {
  const trimmed = String(email || "").trim().toLowerCase();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw Object.assign(new Error("The administrator email is required for Let’s Encrypt"), { statusCode: 400 });
  }
  return trimmed;
}
