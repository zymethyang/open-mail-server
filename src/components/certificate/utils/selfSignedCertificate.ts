import crypto from "node:crypto";
import type { GeneratedCertificate } from "../interfaces/generatedCertificate.js";
export type { GeneratedCertificate };

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

function extension(objectIdentifier: string, value: Buffer): Buffer {
  return sequence(encodeObjectIdentifier(objectIdentifier), encodeTag(0x04, value));
}

function subjectAlternativeName(domains: string[]): Buffer {
  const names = [encodeTag(0x82, Buffer.from("localhost", "ascii")), encodeTag(0x87, Buffer.from([127, 0, 0, 1]))];
  for (const domain of domains) {
    if (domain && domain !== "localhost") {
      names.push(encodeTag(0x82, Buffer.from(domain, "ascii")));
    }
  }
  return sequence(...names);
}

function pem(label: string, body: Buffer): string {
  const base64 = body.toString("base64").match(/.{1,64}/g)?.join("\n") || "";
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}

export function generateSelfSignedCertificate(domains: string[]): GeneratedCertificate {
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyInfo = keys.publicKey.export({ type: "spki", format: "der" });
  const commonName = domains.find((domain) => domain && domain !== "localhost") || "localhost";
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  if (serial[0] === 0) {
    serial[0] = 1;
  }
  const now = new Date();
  const expires = new Date(now.getTime() + 825 * 24 * 60 * 60 * 1000);
  const extensions = encodeTag(
    0xa3,
    sequence(
      extension("2.5.29.19", sequence()),
      extension("2.5.29.15", encodeTag(0x03, Buffer.from([0x00, 0xa0]))),
      extension("2.5.29.37", sequence(encodeObjectIdentifier("1.3.6.1.5.5.7.3.1"))),
      extension("2.5.29.17", subjectAlternativeName(domains))
    )
  );
  const toBeSigned = sequence(
    encodeTag(0xa0, encodeInteger(Buffer.from([2]))),
    encodeInteger(serial),
    algorithmIdentifier(),
    directoryName(commonName),
    sequence(utcTime(now), utcTime(expires)),
    directoryName(commonName),
    publicKeyInfo,
    extensions
  );
  const signature = crypto.sign("sha256", toBeSigned, keys.privateKey);
  const certificate = sequence(toBeSigned, algorithmIdentifier(), encodeTag(0x03, Buffer.concat([Buffer.from([0x00]), signature])));
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return {
    privateKey,
    certificate: pem("CERTIFICATE", certificate)
  };
}
