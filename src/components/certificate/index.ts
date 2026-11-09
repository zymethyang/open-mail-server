import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateSelfSignedCertificate, normalizedCertificateNames } from "./utils/selfSignedCertificate.js";
import { storeCertificateMaterial } from "./utils/storedCertificate.js";
import type { ServerCertificate } from "./interfaces/serverCertificate.js";
export type { CertificateDescription } from "./interfaces/certificateDescription.js";
export type { ServerCertificate };
export { describeCertificateMaterial, prepareCertificateMaterial, storeCertificateMaterial } from "./utils/storedCertificate.js";

export async function ensureSelfSignedCertificate(storageDirectory: string, requiredNames: string[]): Promise<ServerCertificate> {
  const directory = path.join(storageDirectory, "certificates");
  const privateKeyPath = path.join(directory, "private-key.pem");
  const certificatePath = path.join(directory, "certificate.pem");
  try {
    const [privateKey, certificate] = await Promise.all([readFile(privateKeyPath, "utf8"), readFile(certificatePath, "utf8")]);
    return { privateKey, certificate };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const generated = generateSelfSignedCertificate(normalizedCertificateNames(requiredNames));
  await storeCertificateMaterial(storageDirectory, generated.certificate, generated.privateKey);
  return generated;
}

export async function loadCertificate(storageDirectory: string, domains: string[]): Promise<ServerCertificate> {
  return ensureSelfSignedCertificate(storageDirectory, domains);
}
