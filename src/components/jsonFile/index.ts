import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSealedEnvelope, openSealedValue, sealValue } from "../secureStorage/index.js";

export async function parseStoredJson<T>(contents: string, purpose = ""): Promise<T> {
  const parsed = JSON.parse(contents) as unknown;
  if (isSealedEnvelope(parsed)) {
    return openSealedValue<T>(parsed, purpose);
  }
  return parsed as T;
}

export async function readJson<T>(filePath: string): Promise<T> {
  const contents = await readFile(filePath, "utf8");
  return parseStoredJson<T>(contents, path.basename(filePath));
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const sealed = await sealValue(value, path.basename(filePath));
  const temporaryPath = `${filePath}.${process.pid}.temporary`;
  await writeFile(temporaryPath, `${JSON.stringify(sealed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rm(filePath, { force: true });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export { withLock } from "./utils/fileLock.js";
