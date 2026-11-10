import crypto from "node:crypto";
import type { GeneratedCertificate } from "../interfaces/generatedCertificate.js";
import type { AuthoritySignedCertificate } from "../interfaces/authoritySignedCertificate.js";
export type { GeneratedCertificate, AuthoritySignedCertificate };

function encodeLength(length: number): Buffer {
  if (length < 128) {
    return Buffer.from([length]);
  }
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function encodeTag(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

function sequence(...parts: Buffer[]): Buffer {
  return encodeTag(0x30, Buffer.concat(parts));
}

function encodeObjectIdentifier(objectIdentifier: string): Buffer {
  const numbers = objectIdentifier.split(".").map((part) => Number(part));
  const body = [40 * numbers[0] + numbers[1]];
  for (const number of numbers.slice(2)) {
    const encoded: number[] = [number & 0x7f];
    let value = Math.floor(number / 128);
    while (value > 0) {
      encoded.unshift((value & 0x7f) | 0x80);
      value = Math.floor(value / 128);
    }
    body.push(...encoded);
  }
  return encodeTag(0x06, Buffer.from(body));
}

function encodeInteger(payload: Buffer): Buffer {
  let integer = payload.length ? payload : Buffer.from([0]);
  while (integer.length > 1 && integer[0] === 0 && (integer[1] & 0x80) === 0) {
    integer = integer.subarray(1);
  }
  if (integer[0] & 0x80) {
    integer = Buffer.concat([Buffer.from([0]), integer]);
  }
  return encodeTag(0x02, integer);
}

function encodeUtf8(value: string): Buffer {
  return encodeTag(0x0c, Buffer.from(value, "utf8"));
}

function utcTime(date: Date): Buffer {
  const year = String(date.getUTCFullYear()).slice(-2).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return encodeTag(0x17, Buffer.from(`${year}${month}${day}${hours}${minutes}${seconds}Z`, "ascii"));
}

function algorithmIdentifier(): Buffer {
  return sequence(encodeObjectIdentifier("1.2.840.113549.1.1.11"), Buffer.from([0x05, 0x00]));
}

function directoryName(commonName: string): Buffer {
  const attribute = sequence(encodeObjectIdentifier("2.5.4.3"), encodeUtf8(commonName));
  return sequence(encodeTag(0x31, attribute));
}

function extension(objectIdentifier: string, value: Buffer, critical = false): Buffer {
  const parts = [encodeObjectIdentifier(objectIdentifier)];
  if (critical) {
    parts.push(encodeTag(0x01, Buffer.from([0xff])));
  }
  parts.push(encodeTag(0x04, value));
  return sequence(...parts);
}

function isInternetProtocolAddress(value: string): boolean {
  const octets = value.split(".");
  return octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

export function normalizedCertificateNames(values: string[]): string[] {
  const names: string[] = [];
  const add = (value: string) => {
    if (value && !names.some((name) => name.toLowerCase() === value.toLowerCase())) {
      names.push(value);
    }
  };
  add("localhost");
  add("127.0.0.1");
  for (const value of values) {
    const trimmed = String(value || "").trim().replace(/\.$/, "");
    if (!trimmed || trimmed.length > 253) {
      continue;
    }
    add(isInternetProtocolAddress(trimmed) ? trimmed : trimmed.toLowerCase());
  }
  return names;
}

function subjectAlternativeName(names: string[]): Buffer {
  const alternatives = names.map((name) => {
    if (isInternetProtocolAddress(name)) {
      return encodeTag(0x87, Buffer.from(name.split(".").map((octet) => Number(octet))));
    }
    return encodeTag(0x82, Buffer.from(name, "ascii"));
  });
  return sequence(...alternatives);
}

function pem(label: string, body: Buffer): string {
  const base64 = body.toString("base64").match(/.{1,64}/g)?.join("\n") || "";
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}

function randomSerial(): Buffer {
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  if (serial[0] === 0) {
    serial[0] = 1;
  }
  return serial;
}

function serverExtensions(names: string[]): Buffer {
  return encodeTag(
    0xa3,
    sequence(
      extension("2.5.29.19", sequence()),
      extension("2.5.29.15", encodeTag(0x03, Buffer.from([0x00, 0xa0]))),
      extension("2.5.29.37", sequence(encodeObjectIdentifier("1.3.6.1.5.5.7.3.1"))),
      extension("2.5.29.17", subjectAlternativeName(names))
    )
  );
}

function authorityExtensions(): Buffer {
  return encodeTag(
    0xa3,
    sequence(
      extension("2.5.29.19", sequence(encodeTag(0x01, Buffer.from([0xff]))), true),
      extension("2.5.29.15", encodeTag(0x03, Buffer.from([0x00, 0x06])), true)
    )
  );
}

function buildSignedCertificate(issuerName: Buffer, subjectName: Buffer, publicKeyInfo: Buffer, signingKey: crypto.KeyObject, extensions: Buffer): Buffer {
  const now = new Date();
  const expires = new Date(now.getTime() + 825 * 24 * 60 * 60 * 1000);
  const toBeSigned = sequence(
    encodeTag(0xa0, encodeInteger(Buffer.from([2]))),
    encodeInteger(randomSerial()),
    algorithmIdentifier(),
    issuerName,
    sequence(utcTime(now), utcTime(expires)),
    subjectName,
    publicKeyInfo,
    extensions
  );
  const signature = crypto.sign("sha256", toBeSigned, signingKey);
  return sequence(toBeSigned, algorithmIdentifier(), encodeTag(0x03, Buffer.concat([Buffer.from([0x00]), signature])));
}

function createKeyPair(): { privateKey: crypto.KeyObject; privateKeyPem: string; publicKeyInfo: Buffer } {
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey: keys.privateKey,
    privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyInfo: keys.publicKey.export({ type: "spki", format: "der" }) as Buffer
  };
}

function leafCertificateNames(values: string[]): string[] {
  const names: string[] = [];
  for (const value of values) {
    const trimmed = String(value || "").trim().replace(/\.$/, "");
    if (!trimmed || trimmed.length > 253) {
      continue;
    }
    const name = isInternetProtocolAddress(trimmed) ? trimmed : trimmed.toLowerCase();
    if (!names.some((item) => item.toLowerCase() === name.toLowerCase())) {
      names.push(name);
    }
  }
  return names;
}

export function generateSelfSignedCertificate(domains: string[]): GeneratedCertificate {
  const names = normalizedCertificateNames(domains);
  const keys = createKeyPair();
  const commonName = names.find((name) => name !== "localhost" && !isInternetProtocolAddress(name)) || "localhost";
  const subjectName = directoryName(commonName);
  const certificate = buildSignedCertificate(subjectName, subjectName, keys.publicKeyInfo, keys.privateKey, serverExtensions(names));
  return {
    privateKey: keys.privateKeyPem,
    certificate: pem("CERTIFICATE", certificate)
  };
}

export function generateAuthoritySignedCertificate(names: string[]): AuthoritySignedCertificate {
  const leafNames = leafCertificateNames(names);
  if (!leafNames.length) {
    throw new Error("A certificate needs a domain name");
  }
  const rootName = directoryName("Example Root Authority");
  const intermediateName = directoryName("Example Intermediate Authority");
  const leafName = directoryName(leafNames.find((name) => !isInternetProtocolAddress(name)) || leafNames[0]);
  const rootKey = createKeyPair();
  const intermediateKey = createKeyPair();
  const leafKey = createKeyPair();
  return {
    rootCertificate: pem("CERTIFICATE", buildSignedCertificate(rootName, rootName, rootKey.publicKeyInfo, rootKey.privateKey, authorityExtensions())),
    intermediateCertificate: pem(
      "CERTIFICATE",
      buildSignedCertificate(rootName, intermediateName, intermediateKey.publicKeyInfo, rootKey.privateKey, authorityExtensions())
    ),
    certificate: pem(
      "CERTIFICATE",
      buildSignedCertificate(intermediateName, leafName, leafKey.publicKeyInfo, intermediateKey.privateKey, serverExtensions(leafNames))
    ),
    privateKey: leafKey.privateKeyPem
  };
}
