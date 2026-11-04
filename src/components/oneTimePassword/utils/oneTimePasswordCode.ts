import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(value: Buffer): string {
  let bits = 0;
  let buffer = 0;
  let encoded = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += base32Alphabet[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) {
    encoded += base32Alphabet[(buffer << (5 - bits)) & 31];
  }
  return encoded;
}

export function decodeBase32(value: string): Buffer {
  const cleaned = value.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of cleaned) {
    const index = base32Alphabet.indexOf(character);
    if (index < 0) {
      continue;
    }
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

export function createOneTimePasswordSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function oneTimePassword(secret: Buffer, time = Date.now(), stepSeconds = 30, digits = 6): string {
  const counter = Math.floor(time / 1000 / stepSeconds);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary =
    ((digest[offset] & 127) << 24) |
    ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) |
    (digest[offset + 3] & 255);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function oneTimePasswordMatches(secret: Buffer, code: string, time = Date.now()): boolean {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }
  const provided = Buffer.from(normalized);
  for (const offset of [-1, 0, 1]) {
    const expected = Buffer.from(oneTimePassword(secret, time + offset * 30_000));
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
      return true;
    }
  }
  return false;
}

export function oneTimePasswordUri(input: { issuer: string; accountName: string; secret: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`;
  const query = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
