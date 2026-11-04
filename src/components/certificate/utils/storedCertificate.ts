import { X509Certificate, createPrivateKey } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";
import type { CertificateDescription } from "../interfaces/certificateDescription.js";

const maximumPemCharacters = 64 * 1024;

function certificateNames(parsed: X509Certificate): string[] {
  const names = new Set<string>();
  const commonName = /CN=([^,\n/]+)/.exec(parsed.subject)?.[1]?.trim();
  if (commonName) {
    names.add(commonName);
  }
  for (const part of (parsed.subjectAltName || "").split(",")) {
    const match = /^(?:DNS|IP Address):(.+)$/.exec(part.trim());
    if (match) {
      names.add(match[1].trim());
    }
  }
  return [...names];
}

export function describeCertificateMaterial(certificatePem: string, privateKeyPem: string): CertificateDescription {
  const certificateText = certificatePem.trim();
  const privateKeyText = privateKeyPem.trim();
  if (!certificateText || !privateKeyText) {
    throw Object.assign(new Error("Choose both the certificate and the private key"), { statusCode: 400 });
  }
  if (certificateText.length > maximumPemCharacters || privateKeyText.length > maximumPemCharacters) {
    throw Object.assign(new Error("The certificate or private key is too large"), { statusCode: 400 });
  }
  if (privateKeyText.includes("ENCRYPTED PRIVATE KEY")) {
    throw Object.assign(new Error("The private key must not be password protected"), { statusCode: 400 });
  }
  if (!certificateText.includes("BEGIN CERTIFICATE") || !/BEGIN (?:RSA |EC )?PRIVATE KEY/.test(privateKeyText)) {
    throw Object.assign(new Error("Upload a PEM certificate and a PEM private key"), { statusCode: 400 });
  }
  try {
    const parsed = new X509Certificate(certificateText);
    const key = createPrivateKey(privateKeyText);
    if (!parsed.checkPrivateKey(key)) {
      throw Object.assign(new Error("The private key does not match the certificate"), { statusCode: 400 });
    }
    tls.createSecureContext({ key: privateKeyText, cert: certificateText, minVersion: "TLSv1.2" });
    return {
      subject: parsed.subject,
      issuer: parsed.issuer,
      validFrom: parsed.validFrom,
      validUntil: parsed.validTo,
      names: certificateNames(parsed),
      selfSigned: parsed.issuer === parsed.subject
    };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    throw Object.assign(new Error("The certificate or private key could not be read"), { statusCode: 400 });
  }
}

export async function storeCertificateMaterial(storageDirectory: string, certificatePem: string, privateKeyPem: string): Promise<CertificateDescription> {
  const description = describeCertificateMaterial(certificatePem, privateKeyPem);
  const directory = path.join(storageDirectory, "certificates");
  await mkdir(directory, { recursive: true });
  const certificatePath = path.join(directory, "certificate.pem");
  const keyPath = path.join(directory, "private-key.pem");
  const certificateText = `${certificatePem.trim()}\n`;
  const privateKeyText = `${privateKeyPem.trim()}\n`;
  await writeFile(certificatePath, certificateText, { encoding: "utf8", mode: 0o644 });
  await writeFile(keyPath, privateKeyText, { encoding: "utf8", mode: 0o600 });
  await chmod(keyPath, 0o600).catch(() => undefined);
  return description;
}
