import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { domainKeySelector } from "../../../src/components/domainKey/index.js";
import { createDnsGuide, formatDnsGuideForTerminal } from "../../../src/components/web/utils/dnsGuide.js";

describe("dns guide", () => {
  it("allows the public address with a soft failure and publishes DKIM and DMARC", () => {
    const domainKeyValue = `v=DKIM1; k=rsa; p=${"A".repeat(400)}`;
    const guide = createDnsGuide("example.test", "example.test", "203.0.113.10", domainKeyValue);
    assert.deepEqual(guide.records[0], { type: "A", host: "example.test", value: "203.0.113.10" });
    assert.equal(guide.records[1].value, "10 example.test");
    assert.equal(recordValue(guide.records, "v=spf1"), "v=spf1 ip4:203.0.113.10 ~all");
    assert.equal(guide.records.find((record) => record.host === `${domainKeySelector}._domainkey.example.test`)?.value, domainKeyValue);
    assert.equal(guide.records.find((record) => record.host === "_dmarc.example.test")?.value, "v=DMARC1; p=none; rua=mailto:admin@example.test");
    assert.match(guide.zoneFile, /example\.test\.\t300\tIN\tA\t203\.0\.113\.10/);
    assert.match(guide.zoneFile, /IN\tMX\t10 example\.test\./);
    assert.match(guide.zoneFile, /IN\tTXT\t"v=spf1 ip4:203\.0\.113\.10 ~all"/);
    assert.equal(guide.zoneFile.includes("-all"), false);
    const domainKeyLine = guide.zoneFile.split("\n").find((line) => line.includes("._domainkey.")) || "";
    const quoted = domainKeyLine.match(/"[^"]*"/g) || [];
    assert.equal(quoted.length >= 2, true);
    assert.equal(quoted.map((chunk) => chunk.slice(1, -1)).join(""), domainKeyValue);
    assert.match(guide.zoneFile, /_dmarc\.example\.test\.\t300\tIN\tTXT\t"v=DMARC1; p=none; rua=mailto:admin@example\.test"/);
  });

  it("uses an address record for an internet protocol version 6 address", () => {
    const guide = createDnsGuide("acme.test", "mail.acme.test", "2001:db8::1");
    assert.equal(guide.records[0].type, "AAAA");
    assert.equal(guide.records[0].value, "2001:db8::1");
    assert.equal(recordValue(guide.records, "v=spf1"), "v=spf1 ip6:2001:db8::1 ~all");
  });

  it("sends DMARC reports to the administrator email address", () => {
    const guide = createDnsGuide("acme.test", "mail.acme.test", "203.0.113.10", "", "ada@acme.test");
    assert.equal(guide.records[0].value, "203.0.113.10");
    assert.equal(recordValue(guide.records, "v=spf1"), "v=spf1 ip4:203.0.113.10 ~all");
    assert.equal(guide.records.find((record) => record.host === "_dmarc.acme.test")?.value, "v=DMARC1; p=none; rua=mailto:ada@acme.test");
    assert.match(guide.zoneFile, /_dmarc\.acme\.test\.\t300\tIN\tTXT\t"v=DMARC1; p=none; rua=mailto:ada@acme\.test"/);
  });

  it("writes the zone file for the terminal under the company domain", () => {
    const guide = createDnsGuide("acme.test", "mail.acme.test", "1.2.3.4", "v=DKIM1; k=rsa; p=abc", "ada@acme.test");
    const text = formatDnsGuideForTerminal("acme.test", guide.zoneFile);
    assert.match(text, /^DNS records for acme\.test\nPublish these records at the company DNS host before other companies can deliver mail\.\n\n/);
    assert.match(text, /acme\.test\.\t300\tIN\tA\t1\.2\.3\.4/);
    assert.match(text, /IN\tMX\t10 mail\.acme\.test\./);
    assert.match(text, /v=DKIM1/);
    assert.match(text, /rua=mailto:ada@acme\.test/);
    assert.equal(text.includes("Open the web console and create the company"), false);
  });

  it("leaves the address blank when this server cannot discover it", () => {
    const guide = createDnsGuide("acme.test", "mail.acme.test", "  ");
    assert.equal(guide.records[0].value, "");
    assert.equal(guide.zoneFile.includes("IN\tA\t"), false);
    assert.match(guide.zoneFile, /mail\.acme\.test\./);
    assert.equal(recordValue(guide.records, "v=spf1"), "v=spf1 ~all");
    assert.equal(guide.zoneFile.includes("ip4:"), false);
    assert.equal(guide.zoneFile.includes("ip6:"), false);
    assert.match(guide.zoneFile, /_dmarc\.acme\.test\.\t300\tIN\tTXT\t"v=DMARC1; p=none; rua=mailto:admin@acme\.test"/);
    assert.equal(guide.records.some((record) => record.host.includes("._domainkey.")), false);
  });
});

function recordValue(records: { value: string }[], prefix: string): string {
  return records.find((record) => record.value.startsWith(prefix))?.value || "";
}
