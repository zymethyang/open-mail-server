import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ActivityAction } from "../../../../src/components/activity/enums/activityAction.js";

describe("activity action", () => {
  it("keeps the values written to mail storage", () => {
    assert.equal(ActivityAction.Deliver, "deliver");
    assert.equal(ActivityAction.Reject, "reject");
    assert.equal(ActivityAction.SignIn, "sign-in");
    assert.equal(ActivityAction.Queue, "queue");
    assert.equal(ActivityAction.Account, "account");
  });
});
