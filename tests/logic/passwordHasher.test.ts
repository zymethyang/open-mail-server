import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPassword, passwordsMatch } from "../../src/components/account/utils/passwordHasher.js";

describe("password hashing logic", () => {
  it("matches the original password and rejects a different password", () => {
    const stored = hashPassword("correct-horse");
    assert.notEqual(stored.hash, "correct-horse");
    assert.equal(stored.salt.length, 32);
    assert.equal(passwordsMatch("correct-horse", stored.salt, stored.hash), true);
    assert.equal(passwordsMatch("wrong-horse", stored.salt, stored.hash), false);
  });

  it("rejects a missing salt, a missing hash, and a hash of the wrong length", () => {
    const stored = hashPassword("correct-horse");
    assert.equal(passwordsMatch("correct-horse", "", stored.hash), false);
    assert.equal(passwordsMatch("correct-horse", stored.salt, ""), false);
    assert.equal(passwordsMatch("correct-horse", stored.salt, "abcd"), false);
    assert.equal(passwordsMatch("correct-horse"), false);
  });
});
