import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withLock } from "../../../../src/components/jsonFile/utils/fileLock.js";

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
});
