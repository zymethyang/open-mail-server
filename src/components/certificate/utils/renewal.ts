import { X509Certificate } from "node:crypto";
import { normalizedCertificateNames } from "./selfSignedCertificate.js";

export const certificateRenewalWindowDays = 14;

export interface CertificateRenewal {
  daysRemaining: number;
  renewalRequired: boolean;
}

export function certificateRenewal(validUntil: string, now = Date.now()): CertificateRenewal {
  const expires = Date.parse(validUntil);
  if (Number.isNaN(expires)) {
    return { daysRemaining: 0, renewalRequired: true };
  }
  const daysRemaining = Math.ceil((expires - now) / (24 * 60 * 60 * 1000));
  return { daysRemaining, renewalRequired: daysRemaining <= certificateRenewalWindowDays };
}

export function certificateCoversNames(certificatePem: string, requiredNames: string[]): boolean {
  const certificate = new X509Certificate(certificatePem);
  const present = new Set<string>();
  const commonName = /CN=([^,\n/]+)/.exec(certificate.subject)?.[1]?.trim();
  if (commonName) {
    present.add(commonName.toLowerCase());
  }
  for (const part of (certificate.subjectAltName || "").split(",")) {
    const match = /^(?:DNS|IP Address):(.+)$/.exec(part.trim());
    if (match) {
      present.add(match[1].trim().toLowerCase());
    }
  }
  return normalizedCertificateNames(requiredNames).every((name) => present.has(name.toLowerCase()));
}

export function selfSignedCertificateNeedsRenewal(certificatePem: string, now = Date.now()): boolean {
  try {
    const certificate = new X509Certificate(certificatePem);
    if (certificate.issuer !== certificate.subject) {
      return false;
    }
    return certificateRenewal(certificate.validTo, now).renewalRequired;
  } catch {
    return false;
  }
}
