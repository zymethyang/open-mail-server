import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startupBanner } from "../../../src/components/emailServer/utils/startupBanner.js";
import type { ListenerStatus } from "../../../src/components/web/interfaces/listenerStatus.js";

const listeners: ListenerStatus[] = [
  { name: "Web", port: 3000, security: "HTTP", purpose: "Administrator and mailbox", started: true, detail: "" }
];

describe("startup banner", () => {
  it("asks for the company when no DNS guide is stored", () => {
    const text = startupBanner({
      storageDirectory: "C:\\mail\\data",
      connectionHost: "127.0.0.1",
      listeners,
      networkAddresses: ["192.168.1.20"],
      publishNetworkAddresses: true,
      dnsGuide: null
    });
    assert.match(text, /Open Mail Server/);
    assert.match(text, /Storage  C:\\mail\\data/);
    assert.match(text, /http:\/\/127\.0\.0\.1:3000/);
    assert.match(text, /Other computers on this network can open http:\/\/192\.168\.1\.20:3000/);
    assert.match(text, /Open the web console and create the company/);
    assert.equal(text.includes("DNS records for"), false);
  });

  it("prints the stored DNS guide instead of the setup prompt", () => {
    const zoneFile = "acme.test.\t300\tIN\tA\t1.2.3.4\n";
    const text = startupBanner({
      storageDirectory: "C:\\mail\\data",
      connectionHost: "127.0.0.1",
      listeners,
      networkAddresses: [],
      publishNetworkAddresses: false,
      dnsGuide: { domain: "acme.test", zoneFile }
    });
    assert.match(text, /DNS records for acme\.test/);
    assert.match(text, /acme\.test\.\t300\tIN\tA\t1\.2\.3\.4/);
    assert.equal(text.includes("Open the web console and create the company"), false);
    assert.equal(text.includes("Other computers on this network"), false);
  });
});
