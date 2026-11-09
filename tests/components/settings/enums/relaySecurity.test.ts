import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RelaySecurity } from "../../../../src/components/settings/enums/relaySecurity.js";

describe("relay security", () => {
  it("keeps the values written to mail storage", () => {
    assert.equal(RelaySecurity.StartTls, "starttls");
    assert.equal(RelaySecurity.Tls, "tls");
    assert.equal(RelaySecurity.Plain, "plain");
  });
});
