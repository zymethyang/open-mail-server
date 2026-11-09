import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PortReachabilityResult } from "../../../../src/components/publicPort/enums/portReachabilityResult.js";

describe("port reachability result", () => {
  it("keeps the values written to mail storage", () => {
    assert.equal(PortReachabilityResult.Open, "Open");
    assert.equal(PortReachabilityResult.Closed, "Closed");
    assert.equal(PortReachabilityResult.Unknown, "Unknown");
  });
});
