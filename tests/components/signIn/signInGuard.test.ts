import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signInAttemptLimit, signInBlockMilliseconds, signInWindowMilliseconds } from "../../../src/components/signIn/constants/signInLimits.js";
import { SignInGuard } from "../../../src/components/signIn/index.js";

describe("sign-in guard logic", () => {
  it("blocks a key after the attempt limit and clears it after success", () => {
    const guard = new SignInGuard();
    assert.equal(signInAttemptLimit, 8);
    assert.equal(signInWindowMilliseconds, 10 * 60 * 1000);
    assert.equal(signInBlockMilliseconds, 10 * 60 * 1000);
    for (let attempt = 0; attempt < signInAttemptLimit - 1; attempt += 1) {
      guard.recordFailure("sign-in:ada@acme.test");
    }
    assert.equal(guard.rejectionMessage("sign-in:ada@acme.test"), "");
    guard.recordFailure("sign-in:ada@acme.test");
    assert.equal(guard.rejectionMessage("sign-in:ada@acme.test"), "Too many sign-in attempts. Try again later.");
    assert.equal(guard.rejectionMessage("sign-in:bea@acme.test"), "");
    guard.recordSuccess("sign-in:ada@acme.test");
    assert.equal(guard.rejectionMessage("sign-in:ada@acme.test"), "");
  });

  it("starts a new count for a key that has not been seen", () => {
    const guard = new SignInGuard();
    guard.recordFailure("sign-in:ada@acme.test");
    guard.recordSuccess("sign-in:missing@acme.test");
    assert.equal(guard.rejectionMessage("sign-in:ada@acme.test"), "");
  });
});
