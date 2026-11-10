import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailAuthenticationLookup } from "../../../src/components/mailAuthentication/interfaces/mailAuthenticationLookup.js";
import { evaluateSenderPolicy } from "../../../src/components/mailAuthentication/utils/senderPolicy.js";

function lookup(records: Record<string, string[]>, addresses: Record<string, string[]> = {}): MailAuthenticationLookup {
  return {
    async resolveText(name) {
      if (records[name] === undefined && name.startsWith("down.")) {
        throw Object.assign(new Error("timed out"), { code: "ETIMEOUT" });
      }
      return records[name] || [];
    },
    async resolveAddresses(name) {
      return addresses[name] || [];
    },
    async resolveMailExchanges(name) {
      return name === "mx.example.test" ? ["mail.example.test"] : [];
    }
  };
}

describe("sender policy", () => {
  it("passes, fails, and stays neutral from the published mechanisms", async () => {
    const policy = lookup({
      "example.test": ["v=spf1 ip4:203.0.113.10 ip4:203.0.113.0/24 -all"],
      "included.test": ["v=spf1 ip4:198.51.100.4 -all"],
      "redirected.test": ["v=spf1 redirect=example.test"],
      "address.example.test": ["v=spf1 a:web.example.test -all"],
      "mx.example.test": ["v=spf1 mx -all"]
    }, {
      "web.example.test": ["192.0.2.20"],
      "mail.example.test": ["192.0.2.30"]
    });
    assert.equal(await evaluateSenderPolicy("example.test", "203.0.113.10", policy), "pass");
    assert.equal(await evaluateSenderPolicy("example.test", "203.0.113.50", policy), "pass");
    assert.equal(await evaluateSenderPolicy("example.test", "198.51.100.1", policy), "fail");
    assert.equal(await evaluateSenderPolicy("included.test", "198.51.100.4", lookup({ "included.test": ["v=spf1 include:example.test -all"], "example.test": ["v=spf1 ip4:198.51.100.4 -all"] })), "pass");
    assert.equal(await evaluateSenderPolicy("redirected.test", "203.0.113.10", policy), "pass");
    assert.equal(await evaluateSenderPolicy("address.example.test", "192.0.2.20", policy), "pass");
    assert.equal(await evaluateSenderPolicy("mx.example.test", "192.0.2.30", policy), "pass");
    assert.equal(await evaluateSenderPolicy("missing.test", "203.0.113.10", policy), "none");
    assert.equal(await evaluateSenderPolicy("down.example.test", "203.0.113.10", policy), "temperror");
  });
});
