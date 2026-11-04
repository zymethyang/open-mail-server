import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanDisplayName, oneLine } from "../../src/components/text/index.js";

describe("plain text logic", () => {
  it("collapses line breaks and limits the length", () => {
    assert.equal(oneLine("  hello\r\nworld\n", 8), "hello wo");
    assert.equal(oneLine(null), "");
    assert.equal(oneLine(undefined, 5), "");
  });

  it("keeps a display name on one line and within 80 characters", () => {
    assert.equal(cleanDisplayName(" Ada\nNguyen "), "Ada Nguyen");
    assert.equal(cleanDisplayName("x".repeat(100)).length, 80);
    assert.equal(cleanDisplayName(null), "");
  });
});
