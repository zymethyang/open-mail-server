import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const markerFileName = "acme-managed";
const accountKeyFileName = "acme-account-key.pem";
const accountUrlFileName = "acme-account.url";

export function certificateDirectory(storageDirectory: string): string {
  return path.join(storageDirectory, "certificates");
}

export async function isAcmeManagedCertificate(storageDirectory: string): Promise<boolean> {
  try {
    const marker = await readFile(path.join(certificateDirectory(storageDirectory), markerFileName), "utf8");
    return marker.trim() === "lets-encrypt";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function markAcmeManagedCertificate(storageDirectory: string): Promise<void> {
  const directory = certificateDirectory(storageDirectory);
  await mkdir(directory, { recursive: true });
  const markerPath = path.join(directory, markerFileName);
  await writeFile(markerPath, "lets-encrypt\n", { encoding: "utf8", mode: 0o644 });
}

export async function clearAcmeManagedCertificate(storageDirectory: string): Promise<void> {
  try {
    await unlink(path.join(certificateDirectory(storageDirectory), markerFileName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function readAcmeAccountKey(storageDirectory: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(certificateDirectory(storageDirectory), accountKeyFileName), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function storeAcmeAccountKey(storageDirectory: string, accountKeyPem: string): Promise<void> {
  const directory = certificateDirectory(storageDirectory);
  await mkdir(directory, { recursive: true });
  const keyPath = path.join(directory, accountKeyFileName);
  await writeFile(keyPath, accountKeyPem, { encoding: "utf8", mode: 0o600 });
  await chmod(keyPath, 0o600).catch(() => undefined);
}

export async function readAcmeAccountUrl(storageDirectory: string): Promise<string | undefined> {
  try {
    const value = await readFile(path.join(certificateDirectory(storageDirectory), accountUrlFileName), "utf8");
    return value.trim() || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function storeAcmeAccountUrl(storageDirectory: string, accountUrl: string): Promise<void> {
  const directory = certificateDirectory(storageDirectory);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, accountUrlFileName), `${accountUrl.trim()}\n`, { encoding: "utf8", mode: 0o644 });
}
