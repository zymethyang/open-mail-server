import crypto from "node:crypto";

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

function algorithmIdentifier(): Buffer {
  return sequence(encodeObjectIdentifier("1.2.840.113549.1.1.11"), Buffer.from([0x05, 0x00]));
}

function directoryName(commonName: string): Buffer {
  const attribute = sequence(encodeObjectIdentifier("2.5.4.3"), encodeUtf8(commonName));
  return sequence(encodeTag(0x31, attribute));
}

function subjectAlternativeName(hostname: string): Buffer {
  return sequence(encodeTag(0x82, Buffer.from(hostname, "ascii")));
}

function extensionRequest(hostname: string): Buffer {
  const extension = sequence(encodeObjectIdentifier("2.5.29.17"), encodeTag(0x04, subjectAlternativeName(hostname)));
  const extensions = sequence(extension);
  const attribute = sequence(encodeObjectIdentifier("1.2.840.113549.1.9.14"), encodeTag(0x31, extensions));
  return encodeTag(0xa0, attribute);
}

export function createCertificateSigningRequestDer(hostname: string, privateKey: crypto.KeyObject): Buffer {
  const publicKeyInfo = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }) as Buffer;
  const certificationRequestInfo = sequence(encodeInteger(Buffer.from([0])), directoryName(hostname), publicKeyInfo, extensionRequest(hostname));
  const signature = crypto.sign("sha256", certificationRequestInfo, privateKey);
  return sequence(certificationRequestInfo, algorithmIdentifier(), encodeTag(0x03, Buffer.concat([Buffer.from([0x00]), signature])));
}

export function createCertificateSigningRequestBase64Url(hostname: string, privateKey: crypto.KeyObject): string {
  const der = createCertificateSigningRequestDer(hostname, privateKey);
  return der.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
