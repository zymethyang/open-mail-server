import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOneTimePasswordSecret,
  decodeBase32,
  encodeBase32,
  oneTimePassword,
  oneTimePasswordMatches,
  oneTimePasswordUri
} from "../../src/components/oneTimePassword/utils/oneTimePasswordCode.js";

describe("one-time password logic", () => {
  it("round-trips base32 and ignores padding and separators", () => {
    const secret = Buffer.from("12345678901234567890");
    const encoded = encodeBase32(secret);
    assert.deepEqual(decodeBase32(encoded.toLowerCase() + "=="), secret);
    assert.deepEqual(decodeBase32("----"), Buffer.alloc(0));
    assert.equal(decodeBase32(createOneTimePasswordSecret()).length, 20);
  });

  it("matches the published SHA-1 authenticator vector", () => {
    const secret = Buffer.from("12345678901234567890");
    assert.equal(oneTimePassword(secret, 59_000, 30, 8), "94287082");
    assert.equal(oneTimePassword(secret, 59_000, 30, 6), "287082");
  });

  it("accepts the current code and one step on either side", () => {
    const secret = Buffer.from("12345678901234567890");
    const moment = Date.UTC(2026, 10, 4, 12, 0, 0);
    const code = oneTimePassword(secret, moment);
    assert.equal(oneTimePasswordMatches(secret, ` ${code.slice(0, 3)} ${code.slice(3)} `, moment), true);
    assert.equal(oneTimePasswordMatches(secret, code, moment + 30_000), true);
    assert.equal(oneTimePasswordMatches(secret, code, moment - 30_000), true);
    assert.equal(oneTimePasswordMatches(secret, code, moment + 90_000), false);
    assert.equal(oneTimePasswordMatches(secret, "12345", moment), false);
    assert.equal(oneTimePasswordMatches(secret, "abcdef", moment), false);
    assert.equal(oneTimePasswordMatches(secret, "000000", moment), false);
  });

  it("builds an authenticator setup address", () => {
    const uri = oneTimePasswordUri({ issuer: "Email Server", accountName: "ada@acme.test", secret: "SECRET" });
    assert.equal(uri.startsWith("otpauth://totp/Email%20Server:ada%40acme.test?"), true);
    const parameters = new URL(uri).searchParams;
    assert.equal(parameters.get("secret"), "SECRET");
    assert.equal(parameters.get("issuer"), "Email Server");
    assert.equal(parameters.get("algorithm"), "SHA1");
    assert.equal(parameters.get("digits"), "6");
    assert.equal(parameters.get("period"), "30");
  });
});
