import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertAcmeContactEmail, assertAcmeHostname } from "../../../src/components/certificate/utils/acmeHostname.js";

describe("ACME hostname rules", () => {
  it("accepts a public DNS hostname and rejects local names", () => {
    assert.equal(assertAcmeHostname("mail.example.com"), "mail.example.com");
    assert.throws(() => assertAcmeHostname(""), /public hostname/);
    assert.throws(() => assertAcmeHostname("localhost"), /localhost/);
    assert.throws(() => assertAcmeHostname("127.0.0.1"), /loopback|HTTP-01/);
    assert.throws(() => assertAcmeHostname("qa-local.test"), /test domains/);
    assert.throws(() => assertAcmeHostname("203.0.113.10"), /IP address/);
  });

  it("requires an administrator contact email", () => {
    assert.equal(assertAcmeContactEmail("admin@example.com"), "admin@example.com");
    assert.throws(() => assertAcmeContactEmail(""), /administrator email/);
    assert.throws(() => assertAcmeContactEmail("not-an-email"), /administrator email/);
  });
});
