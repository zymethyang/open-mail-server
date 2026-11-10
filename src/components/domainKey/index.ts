import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import path from "node:path";
import type { DomainKey, HeaderField, StoredDomainKey } from "./interfaces/domainKey.js";
import { readJson, writeJson, withLock } from "../jsonFile/index.js";
import { splitHeaderAndBody } from "../mime/index.js";

export const domainKeySelector = "mail";

const signedHeaderNames = ["from", "to", "cc", "subject", "date", "message-id", "mime-version", "content-type"];

export type { DomainKey };

export async function openDomainKey(storageDirectory: string): Promise<DomainKey> {
  return withLock(`domain-key:${storageDirectory}`, async () => {
    const filePath = path.join(storageDirectory, "domain-key.json");
    try {
      const stored = await readJson<StoredDomainKey>(filePath);
      if (!stored.privateKey) {
        throw new Error("The domain key file is incomplete");
      }
      return keyFromPrivateKey(stored.privateKey);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const generated = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKey = generated.privateKey.export({ type: "pkcs8", format: "pem" });
    if (typeof privateKey !== "string") {
      throw new Error("The domain key could not be created");
    }
    await writeJson(filePath, { privateKey });
    return keyFromPrivateKey(privateKey);
  });
}

export function createOutgoingSigner(storageDirectory: string, signingDomain: () => Promise<string>): (rawMessage: Buffer) => Promise<Buffer> {
  return async (rawMessage) => {
    const domain = (await signingDomain()).trim().replace(/\.$/, "").toLowerCase();
    if (!domain) {
      return rawMessage;
    }
    const domainKey = await openDomainKey(storageDirectory);
    return signWithDomainKey(rawMessage, domain, domainKey.privateKey);
  };
}

export function signWithDomainKey(message: Buffer, domain: string, privateKey: string, signedAt = new Date()): Buffer {
  const parts = splitHeaderAndBody(message);
  const fields = headerFields(parts.header);
  if (!fields.some((field) => field.name === "from")) {
    return message;
  }
  const names = signedHeaderNames.filter((name) => fields.some((field) => field.name === name));
  const bodyHash = createHash("sha256").update(canonicalBody(parts.body)).digest("base64");
  const signatureValue = [
    "v=1",
    "a=rsa-sha256",
    "c=relaxed/relaxed",
    `d=${domain}`,
    `s=${domainKeySelector}`,
    `t=${Math.floor(signedAt.getTime() / 1000)}`,
    `bh=${bodyHash}`,
    `h=${names.join(":")}`,
    "b="
  ].join("; ");
  const signedHeaders = `${names.map((name) => canonicalField(lastField(fields, name))).join("")}${canonicalField({ name: "dkim-signature", value: signatureValue })}`;
  const signature = sign("sha256", Buffer.from(signedHeaders, "utf8"), createPrivateKey(privateKey)).toString("base64");
  const header = `DKIM-Signature: ${signatureValue}${foldSignature(signature)}\r\n`;
  return Buffer.concat([Buffer.from(header, "utf8"), message]);
}

export function signatureMatches(message: Buffer, privateKey: string): boolean {
  const parts = splitHeaderAndBody(message);
  const fields = headerFields(parts.header);
  const signatureField = fields.find((field) => field.name === "dkim-signature");
  if (!signatureField) {
    return false;
  }
  const bodyHash = tagValue(signatureField.value, "bh");
  const computedBodyHash = createHash("sha256").update(canonicalBody(parts.body)).digest("base64");
  if (!bodyHash || bodyHash !== computedBodyHash) {
    return false;
  }
  const names = tagValue(signatureField.value, "h").split(":").map((name) => name.trim().toLowerCase()).filter(Boolean);
  if (!names.length || names.some((name) => !lastField(fields, name))) {
    return false;
  }
  const hashedSignature = signatureHeaderForHash(signatureField.value);
  const signedHeaders = `${names.map((name) => canonicalField(lastField(fields, name))).join("")}${canonicalField({ name: "dkim-signature", value: hashedSignature })}`;
  const signature = signatureBytes(signatureField.value);
  if (!signature.length) {
    return false;
  }
  return verify("sha256", Buffer.from(signedHeaders, "utf8"), createPublicKey(privateKey), signature);
}

function keyFromPrivateKey(privateKey: string): DomainKey {
  const publicKey = createPublicKey(createPrivateKey(privateKey));
  const publicKeyBody = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return {
    privateKey,
    recordValue: `v=DKIM1; k=rsa; p=${publicKeyBody}`
  };
}

function headerFields(header: Buffer): HeaderField[] {
  const fields: HeaderField[] = [];
  for (const line of header.toString("utf8").split(/\r\n|\n/)) {
    if (!line) {
      continue;
    }
    if ((line.startsWith(" ") || line.startsWith("\t")) && fields.length) {
      fields[fields.length - 1].value += `\r\n${line}`;
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    fields.push({
      name: line.slice(0, separator).trim().toLowerCase(),
      value: line.slice(separator + 1)
    });
  }
  return fields;
}

function lastField(fields: HeaderField[], name: string): HeaderField {
  for (let index = fields.length - 1; index >= 0; index -= 1) {
    if (fields[index].name === name) {
      return fields[index];
    }
  }
  return { name, value: "" };
}

function canonicalField(field: HeaderField): string {
  const unfolded = field.value.replace(/\r\n([ \t])/g, "$1").replace(/\n([ \t])/g, "$1");
  const reduced = unfolded.replace(/[ \t]+/g, " ").trim();
  return `${field.name}:${reduced}\r\n`;
}

function canonicalBody(body: Buffer): Buffer {
  const lines = body.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const reduced = lines.map((line) => line.replace(/[ \t]+/g, " ").replace(/[ \t]+$/g, ""));
  while (reduced.length > 0 && reduced[reduced.length - 1] === "") {
    reduced.pop();
  }
  if (!reduced.length) {
    return Buffer.alloc(0);
  }
  return Buffer.from(`${reduced.join("\r\n")}\r\n`, "utf8");
}

function signatureHeaderForHash(value: string): string {
  const unfolded = value.replace(/\r\n([ \t])/g, "$1").replace(/\n([ \t])/g, "$1");
  const tag = unfolded.search(/;\s*b\s*=/i);
  if (tag === -1) {
    return unfolded;
  }
  return `${unfolded.slice(0, tag)}; b=`;
}

function signatureBytes(value: string): Buffer {
  const encoded = tagValue(value, "b").replace(/\s+/g, "");
  if (!encoded || !/^[A-Za-z0-9+/=]+$/.test(encoded)) {
    return Buffer.alloc(0);
  }
  return Buffer.from(encoded, "base64");
}

function tagValue(value: string, name: string): string {
  const unfolded = value.replace(/\r\n([ \t])/g, " ").replace(/\n([ \t])/g, " ");
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]*)`, "i").exec(unfolded);
  return (match?.[1] || "").trim();
}

function foldSignature(encoded: string): string {
  const pieces: string[] = [];
  for (let index = 0; index < encoded.length; index += 72) {
    pieces.push(encoded.slice(index, index + 72));
  }
  return pieces.join("\r\n ");
}
