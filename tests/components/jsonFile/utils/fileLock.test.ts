import assert from "node:assert/strict";
import { mkdir, open, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileLockPath, withLock } from "../../../../src/components/jsonFile/utils/fileLock.js";

describe("file lock logic", () => {
  it("runs work for the same name one at a time", async () => {
    let sequence = "";
    const first = withLock("sample-lock", async () => {
      sequence += "a";
      await new Promise((resolve) => setTimeout(resolve, 20));
      sequence += "b";
    });
    const second = withLock("sample-lock", async () => {
      sequence += "c";
    });
    await Promise.all([first, second]);
    assert.equal(sequence, "abc");
  });

  it("continues the next waiter after a failure", async () => {
    const failed = withLock("failure-lock", async () => {
      throw new Error("failed");
    });
    const next = withLock("failure-lock", async () => "ready");
    await assert.rejects(failed, /failed/);
    assert.equal(await next, "ready");
  });

  it("refreshes a lock that is still held", async () => {
    const lockPath = fileLockPath("refresh-lock");
    const held = withLock("refresh-lock", () => new Promise((resolve) => setTimeout(resolve, 5600)));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const before = await stat(lockPath);
    await new Promise((resolve) => setTimeout(resolve, 5200));
    const after = await stat(lockPath);
    await held;
    assert.equal(after.mtimeMs > before.mtimeMs, true);
  });

  it("takes over a lock the previous holder abandoned", async () => {
    const lockPath = fileLockPath("abandoned-lock");
    await mkdir(path.dirname(lockPath), { recursive: true });
    const handle = await open(lockPath, "wx");
    await handle.close();
    const abandoned = new Date(Date.now() - 20_000);
    await utimes(lockPath, abandoned, abandoned);
    assert.equal(await withLock("abandoned-lock", async () => "taken"), "taken");
  });
});
