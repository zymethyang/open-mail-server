import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { isResolvedPathInsideRoot } from "../../../src/components/web/index.js";

describe("public file path containment", () => {
  it("rejects prefix-collision siblings and path escape", () => {
    const resolvedRoot = path.resolve("/app/web");
    const inside = path.resolve(resolvedRoot, "styles", "base.css");
    const siblingPrefix = path.resolve("/app/website", "secret.css");
    const escaped = path.resolve(resolvedRoot, "..", "outside.css");
    assert.equal(isResolvedPathInsideRoot(resolvedRoot, resolvedRoot), true);
    assert.equal(isResolvedPathInsideRoot(inside, resolvedRoot), true);
    assert.equal(isResolvedPathInsideRoot(siblingPrefix, resolvedRoot), false);
    assert.equal(isResolvedPathInsideRoot(escaped, resolvedRoot), false);
    assert.equal(siblingPrefix.startsWith(resolvedRoot), true);
    assert.equal(siblingPrefix.startsWith(`${resolvedRoot}${path.sep}`), false);
  });
});
