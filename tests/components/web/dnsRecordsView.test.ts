import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderDnsRecords } from "../../../src/web/client/components/overview/hosting.js";
import type { HostingInformation } from "../../../src/web/client/interfaces/models.js";

describe("dns records view", () => {
  it("shows the zone file without the record table or the public address notes", () => {
    const zoneFile = [
      "acme.test.\t300\tIN\tA\t192.168.1.90",
      "acme.test.\t300\tIN\tTXT\t\"v=spf1 ip4:192.168.1.90 ~all\"",
      "mail._domainkey.acme.test.\t300\tIN\tTXT\t\"v=DKIM1; k=rsa; p=public\"",
      "_dmarc.acme.test.\t300\tIN\tTXT\t\"v=DMARC1; p=none; rua=mailto:admin@acme.test\""
    ].join("\n");
    const markup = renderDnsRecords(hosting("acme.test", zoneFile));
    assert.equal(markup.includes("<table"), false);
    assert.equal(markup.includes("reverse-resolve"), false);
    assert.equal(markup.includes("Copy one value"), false);
    assert.equal(markup.includes("SPF uses soft fail"), false);
    assert.equal(markup.includes("Public address of this server"), false);
    assert.equal(markup.includes("No network card on this server has a public address."), false);
    assert.equal(markup.includes("Public address not found"), false);
    assert.equal(markup.includes("Copy DNS records"), true);
    assert.equal(markup.includes("Copy for Cloudflare"), false);
    assert.equal(markup.includes("At the company DNS host, point acme.test at this server"), true);
    assert.equal(markup.includes("v=spf1 ip4:192.168.1.90 ~all"), true);
    assert.equal(markup.includes("v=DKIM1; k=rsa; p=public"), true);
    assert.equal(markup.includes("v=DMARC1; p=none; rua=mailto:admin@acme.test"), true);
    assert.equal(markup.includes("mail._domainkey.acme.test"), true);
    assert.equal(markup.includes("_dmarc.acme.test"), true);
  });
});

function hosting(domain: string, zoneFile: string): HostingInformation {
  return {
    domain,
    publicHostname: `mail.${domain}`,
    secureWeb: true,
    zoneFile,
    clients: {
      incomingHost: `mail.${domain}`,
      incomingPort: 993,
      incomingSecurity: "TLS",
      outgoingHost: `mail.${domain}`,
      outgoingPort: 587,
      outgoingSecurity: "STARTTLS"
    },
    dns: []
  };
}
