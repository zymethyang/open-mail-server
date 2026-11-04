import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAddressList,
  domainOf,
  extractEnvelopeAddress,
  isValidAddress,
  normalizeAddress,
  parseAddressList,
  splitAddress
} from "../../src/components/text/index.js";
import { statusCodeOf } from "../support/statusCode.js";

describe("address logic", () => {
  it("normalizes case, space, and surrounding brackets", () => {
    assert.equal(normalizeAddress("  <Ada@Acme.Test>  "), "ada@acme.test");
    assert.equal(normalizeAddress(null), "");
    assert.equal(normalizeAddress(undefined), "");
  });

  it("accepts a normal address and rejects malformed or oversized addresses", () => {
    assert.equal(isValidAddress("Ada@Acme.Test"), true);
    assert.equal(isValidAddress("ada"), false);
    assert.equal(isValidAddress("ada@"), false);
    assert.equal(isValidAddress("ada@@acme.test"), false);
    assert.equal(isValidAddress("ada acme@acme.test"), false);
    assert.equal(isValidAddress(`${"a".repeat(250)}@b.co`), false);
    assert.equal(isValidAddress(""), false);
  });

  it("splits the mailbox and domain", () => {
    assert.deepEqual(splitAddress("Ada@Acme.Test"), { mailbox: "ada", host: "acme.test" });
    assert.deepEqual(splitAddress("mailbox"), { mailbox: "mailbox", host: "" });
    assert.equal(domainOf("ada@acme.test"), "acme.test");
    assert.equal(domainOf("mailbox"), "");
  });

  it("parses comma and semicolon lists and ignores empty pieces", () => {
    assert.deepEqual(parseAddressList(" Ada@Acme.Test, ; bea@acme.test "), ["ada@acme.test", "bea@acme.test"]);
    assert.deepEqual(parseAddressList(null), []);
  });

  it("requires every address in a labeled list", () => {
    assert.throws(
      () => assertAddressList([], "To"),
      (error: unknown) => statusCodeOf(error) === 400 && (error as Error).message === "To is required"
    );
    assert.throws(
      () => assertAddressList(["ada@acme.test", "not-an-address"], "To"),
      (error: unknown) => statusCodeOf(error) === 400 && (error as Error).message.includes("not-an-address")
    );
    assert.doesNotThrow(() => assertAddressList(["ada@acme.test"], "To"));
  });

  it("extracts an envelope address and treats an empty path as no sender", () => {
    assert.equal(extractEnvelopeAddress("FROM:<Ada@Acme.Test>"), "ada@acme.test");
    assert.equal(extractEnvelopeAddress("<>"), "");
    assert.equal(extractEnvelopeAddress(""), "");
    assert.equal(extractEnvelopeAddress("ada@acme.test"), "ada@acme.test");
  });
});
