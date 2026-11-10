import { createHash } from "node:crypto";
import { mkdir, open, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tails = new Map<string, Promise<void>>();
const lockDirectory = path.join(os.tmpdir(), "email-server-file-locks");
const staleLockMilliseconds = 15_000;

async function acquireFileLock(name: string): Promise<() => Promise<void>> {
  await mkdir(lockDirectory, { recursive: true });
  const lockPath = path.join(lockDirectory, createHash("sha256").update(name).digest("hex"));
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.close();
      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > staleLockMilliseconds) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export function withLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(name) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const release = await acquireFileLock(name);
    try {
      return await work();
    } finally {
      await release();
    }
  });
  tails.set(
    name,
    current.then(
      () => undefined,
      () => undefined
    )
  );
  return current;
}
