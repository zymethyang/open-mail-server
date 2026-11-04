const addressPattern = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)*[a-z0-9-]+$/i;

export function normalizeAddress(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^<|>$/g, "")
    .toLowerCase();
}

export function isValidAddress(value: unknown): boolean {
  const address = normalizeAddress(value);
  return address.length <= 254 && addressPattern.test(address);
}

export function domainOf(address: string): string {
  const atIndex = address.lastIndexOf("@");
  return atIndex === -1 ? "" : address.slice(atIndex + 1);
}

export function splitAddress(value: string): { mailbox: string; host: string } {
  const address = normalizeAddress(value);
  const atIndex = address.lastIndexOf("@");
  if (atIndex <= 0) {
    return { mailbox: address, host: "" };
  }
  return {
    mailbox: address.slice(0, atIndex),
    host: address.slice(atIndex + 1)
  };
}

export function parseAddressList(value: unknown): string[] {
  return String(value ?? "")
    .split(/[;,]/)
    .map((item) => normalizeAddress(item))
    .filter(Boolean);
}

export function assertAddressList(values: string[], label: string): void {
  if (!values.length) {
    throw Object.assign(new Error(`${label} is required`), { statusCode: 400 });
  }
  for (const address of values) {
    if (!isValidAddress(address)) {
      throw Object.assign(new Error(`${label} has an invalid address: ${address}`), { statusCode: 400 });
    }
  }
}

export function extractEnvelopeAddress(value: string): string {
  const match = /<([^<>\s]+)>/.exec(value);
  const candidate = match ? match[1] : value.trim();
  if (candidate === "<>" || candidate === "") {
    return "";
  }
  return normalizeAddress(candidate);
}
