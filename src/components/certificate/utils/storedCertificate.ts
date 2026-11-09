import { X509Certificate, createPrivateKey } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";
import type { CertificateDescription } from "../interfaces/certificateDescription.js";

const maximumPemCharacters = 64 * 1024;

interface ParsedCertificate {
  pem: string;
  certificate: X509Certificate;
}

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

function rejected(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function issuerCommonName(distinguishedName: string): string {
  return /CN=([^,\n/]+)/.exec(distinguishedName)?.[1]?.trim() || distinguishedName;
}

function certificateBlocks(text: string): string[] {
  return text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
}

function signedBy(child: X509Certificate, parent: X509Certificate): boolean {
  try {
    return child.verify(parent.publicKey);
  } catch {
    return false;
  }
}

function isTrustAnchor(certificate: X509Certificate): boolean {
  return certificate.issuer === certificate.subject && signedBy(certificate, certificate);
}

function assertCurrent(certificate: X509Certificate): void {
  const now = Date.now();
  if (Date.parse(certificate.validTo) < now) {
    throw rejected("The certificate has expired");
  }
  if (Date.parse(certificate.validFrom) > now) {
    throw rejected("The certificate is not valid yet");
  }
}

function findIssuer(child: X509Certificate, candidates: ParsedCertificate[]): ParsedCertificate | undefined {
  const signers = candidates.filter((item) => item.certificate !== child && signedBy(child, item.certificate));
  return signers.find((item) => item.certificate.subject === child.issuer) || signers[0];
}

export interface PreparedCertificate {
  description: CertificateDescription;
  certificate: string;
  privateKey: string;
}

export function prepareCertificateMaterial(certificatePem: string, privateKeyPem: string, intermediateCertificatesPem = ""): PreparedCertificate {
  const certificateText = String(certificatePem || "").trim();
  const privateKeyText = String(privateKeyPem || "").trim();
  const intermediateText = String(intermediateCertificatesPem || "").trim();
  if (!certificateText || !privateKeyText) {
    throw rejected("Choose both the certificate and the private key");
  }
  if (certificateText.length > maximumPemCharacters || privateKeyText.length > maximumPemCharacters || intermediateText.length > maximumPemCharacters) {
    throw rejected("The certificate or private key is too large");
  }
  if (privateKeyText.includes("ENCRYPTED PRIVATE KEY")) {
    throw rejected("The private key must not be password protected");
  }
  if (/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(certificateText) || /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(intermediateText)) {
    throw rejected("Put the private key in the private key file");
  }
  const keyBlocks = privateKeyText.match(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g) || [];
  const blocks = [...certificateBlocks(certificateText), ...certificateBlocks(intermediateText)];
  if (keyBlocks.length !== 1 || blocks.length === 0) {
    throw rejected("Upload a PEM certificate and a PEM private key");
  }
  if (intermediateText && certificateBlocks(intermediateText).length === 0) {
    throw rejected("The intermediate certificate file could not be read");
  }
  try {
    const privateKey = `${keyBlocks[0].trim()}\n`;
    const key = createPrivateKey(privateKey);
    const parsed: ParsedCertificate[] = [];
    for (const block of blocks) {
      const certificate = new X509Certificate(block);
      if (parsed.some((item) => item.certificate.fingerprint256 === certificate.fingerprint256)) {
        continue;
      }
      parsed.push({ certificate, pem: `${block.trim()}\n` });
    }
    const leaf = parsed.find((item) => item.certificate.checkPrivateKey(key));
    if (!leaf) {
      throw rejected("The private key does not match the certificate");
    }
    const served = [leaf];
    let current = leaf.certificate;
    if (!isTrustAnchor(current)) {
      let signerIncluded = false;
      while (served.length < parsed.length) {
        const issuer = findIssuer(current, parsed.filter((item) => !served.includes(item)));
        if (!issuer) {
          break;
        }
        signerIncluded = true;
        if (isTrustAnchor(issuer.certificate)) {
          break;
        }
        served.push(issuer);
        current = issuer.certificate;
      }
      if (!signerIncluded) {
        throw rejected(`The certificate is signed by ${issuerCommonName(leaf.certificate.issuer)}. Include the intermediate certificates from your certificate provider.`);
      }
    }
    for (const item of served) {
      assertCurrent(item.certificate);
    }
    const certificate = served.map((item) => item.pem).join("");
    tls.createSecureContext({ key: privateKey, cert: certificate, minVersion: "TLSv1.2" });
    return {
      description: {
        subject: leaf.certificate.subject,
        issuer: leaf.certificate.issuer,
        validFrom: leaf.certificate.validFrom,
        validUntil: leaf.certificate.validTo,
        names: certificateNames(leaf.certificate),
        selfSigned: isTrustAnchor(leaf.certificate),
        intermediateCount: served.length - 1
      },
      certificate,
      privateKey
    };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    throw rejected("The certificate or private key could not be read");
  }
}

export function describeCertificateMaterial(certificatePem: string, privateKeyPem: string): CertificateDescription {
  return prepareCertificateMaterial(certificatePem, privateKeyPem).description;
}

export async function storeCertificateMaterial(
  storageDirectory: string,
  certificatePem: string,
  privateKeyPem: string,
  intermediateCertificatesPem = ""
): Promise<CertificateDescription> {
  const prepared = prepareCertificateMaterial(certificatePem, privateKeyPem, intermediateCertificatesPem);
  const directory = path.join(storageDirectory, "certificates");
  await mkdir(directory, { recursive: true });
  const certificatePath = path.join(directory, "certificate.pem");
  const keyPath = path.join(directory, "private-key.pem");
  await writeFile(certificatePath, prepared.certificate, { encoding: "utf8", mode: 0o644 });
  await writeFile(keyPath, prepared.privateKey, { encoding: "utf8", mode: 0o600 });
  await chmod(keyPath, 0o600).catch(() => undefined);
  return prepared.description;
}
