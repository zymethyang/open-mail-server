import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSealedEnvelope, openSealedValue, sealValue } from "../secureStorage/index.js";
import { JsonTransactionSuffix } from "./enums/jsonTransactionSuffix.js";
import { withLock } from "./utils/fileLock.js";

export async function parseStoredJson<T>(contents: string, purpose = ""): Promise<T> {
  const parsed = JSON.parse(contents) as unknown;
  if (isSealedEnvelope(parsed)) {
    return openSealedValue<T>(parsed, purpose);
  }
  return parsed as T;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function transactionPath(filePath: string, suffix: JsonTransactionSuffix): string {
  return `${filePath}${suffix}`;
}

export async function recoverJsonTransaction(filePath: string): Promise<void> {
  const temporaryPath = transactionPath(filePath, JsonTransactionSuffix.Temporary);
  const backupPath = transactionPath(filePath, JsonTransactionSuffix.Backup);
  const destinationExists = await pathExists(filePath);
  const backupExists = await pathExists(backupPath);
  if (backupExists && !destinationExists) {
    await rename(backupPath, filePath);
  } else if (backupExists && destinationExists) {
    await rm(backupPath, { force: true });
  }
  if (await pathExists(temporaryPath)) {
    await rm(temporaryPath, { force: true });
  }
}

export async function readJson<T>(filePath: string): Promise<T> {
  return withLock(`json-file:${filePath}`, async () => {
    await recoverJsonTransaction(filePath);
    const contents = await readFile(filePath, "utf8");
    return parseStoredJson<T>(contents, path.basename(filePath));
  });
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await withLock(`json-file:${filePath}`, async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await recoverJsonTransaction(filePath);
    const sealed = await sealValue(value, path.basename(filePath));
    const temporaryPath = transactionPath(filePath, JsonTransactionSuffix.Temporary);
    const backupPath = transactionPath(filePath, JsonTransactionSuffix.Backup);
    await writeFile(temporaryPath, `${JSON.stringify(sealed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    let movedOriginal = false;
    try {
      await rename(filePath, backupPath);
      movedOriginal = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await rm(temporaryPath, { force: true });
        throw error;
      }
    }
    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      if (movedOriginal) {
        await rename(backupPath, filePath);
      }
      await rm(temporaryPath, { force: true });
      throw error;
    }
    if (movedOriginal) {
      await rm(backupPath, { force: true });
    }
  });
}

export { withLock } from "./utils/fileLock.js";
