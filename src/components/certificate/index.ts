import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateSelfSignedCertificate } from "./utils/selfSignedCertificate.js";
import type { ServerCertificate } from "./interfaces/serverCertificate.js";
export type { CertificateDescription } from "./interfaces/certificateDescription.js";
export type { ServerCertificate };
export { describeCertificateMaterial, storeCertificateMaterial } from "./utils/storedCertificate.js";

export async function loadCertificate(storageDirectory: string, domains: string[]): Promise<ServerCertificate> {
  const directory = path.join(storageDirectory, "certificates");
  const privateKeyPath = path.join(directory, "private-key.pem");
  const certificatePath = path.join(directory, "certificate.pem");
  try {
    const [privateKey, certificate] = await Promise.all([
      readFile(privateKeyPath, "utf8"),
      readFile(certificatePath, "utf8")
    ]);
    return { privateKey, certificate };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const generated = generateSelfSignedCertificate(domains);
  await mkdir(directory, { recursive: true });
  await writeFile(privateKeyPath, generated.privateKey, "utf8");
  await writeFile(certificatePath, generated.certificate, "utf8");
  return generated;
}
