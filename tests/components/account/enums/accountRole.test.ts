import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountRole } from "../../../../src/components/account/enums/accountRole.js";

describe("account role", () => {
  it("keeps the values written to mail storage", () => {
    assert.equal(AccountRole.Administrator, "administrator");
    assert.equal(AccountRole.Member, "member");
  });
});
