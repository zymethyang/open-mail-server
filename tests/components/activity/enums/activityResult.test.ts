import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ActivityResult } from "../../../../src/components/activity/enums/activityResult.js";

describe("activity result", () => {
  it("keeps the values written to mail storage", () => {
    assert.equal(ActivityResult.Accepted, "accepted");
    assert.equal(ActivityResult.Rejected, "rejected");
    assert.equal(ActivityResult.Delivered, "delivered");
    assert.equal(ActivityResult.Queued, "queued");
    assert.equal(ActivityResult.Failed, "failed");
  });
});
