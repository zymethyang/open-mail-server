import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDomainKey, signatureMatches } from "../../../src/components/domainKey/index.js";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

describe("mail authentication records", { concurrency: 1 }, () => {
  it("publishes SPF, DKIM, and DMARC and signs mail that leaves the server", async () => {
    const consoleServer = await startWebConsole({ serverName: "mail.acme.test" });
    try {
      const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
        organizationName: "Acme",
        domain: "acme.test",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      });
      assert.equal(setup.status, 201);
      const summary = await requestJson(consoleServer.baseUrl, "GET", "/api/activity/summary", undefined, setup.cookieHeader);
      assert.equal(summary.status, 200);
      const hosting = record(summary.payload.hosting);
      const records = arrayOf(hosting.dns).map(record);
      const senderPolicy = records.find((item) => String(item.value).startsWith("v=spf1"));
      const domainKeyRecord = records.find((item) => String(item.host).includes("._domainkey."));
      const messagePolicy = records.find((item) => String(item.host).startsWith("_dmarc."));
      const address = records.find((item) => item.type === "A" || item.type === "AAAA");
      assert.equal(String(senderPolicy?.value).includes("~all"), true);
      assert.equal(String(senderPolicy?.value).includes("-all"), false);
      if (address?.value) {
        const mechanism = String(address.value).includes(":") ? `ip6:${address.value}` : `ip4:${address.value}`;
        assert.equal(String(senderPolicy?.value).includes(mechanism), true);
      } else {
        assert.equal(senderPolicy?.value, "v=spf1 ~all");
      }
      assert.equal(domainKeyRecord?.host, "mail._domainkey.acme.test");
      assert.equal(messagePolicy?.value, "v=DMARC1; p=none; rua=mailto:admin@acme.test");
      const zoneLine = String(hosting.zoneFile).split("\n").find((line) => line.includes("._domainkey.")) || "";
      const quoted = zoneLine.match(/"[^"]*"/g) || [];
      assert.equal(quoted.map((chunk) => chunk.slice(1, -1)).join(""), domainKeyRecord?.value);
      const domainKey = await openDomainKey(consoleServer.storageDirectory);
      assert.equal(domainKey.recordValue, domainKeyRecord?.value);
      const sent = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/messages",
        { to: "person@example.test", subject: "Outbound", text: "Signed from the console" },
        setup.cookieHeader
      );
      assert.equal(sent.status, 201);
      const started = Date.now();
      let delivered = "";
      while (Date.now() - started < 4000) {
        delivered = consoleServer.sink.messages.find((message) => message.includes("Signed from the console")) || "";
        if (delivered) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(delivered.startsWith("DKIM-Signature:"), true);
      assert.equal(signatureMatches(Buffer.from(delivered, "utf8"), domainKey.privateKey), true);
    } finally {
      await consoleServer.stop();
    }
  });
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
