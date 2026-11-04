import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";
import { checkPublicPorts } from "../../src/components/publicPort/index.js";
import { PortReachabilityResult } from "../../src/components/publicPort/enums/portReachabilityResult.js";
import { chooseCheckedAddress } from "../../src/components/publicPort/utils/checkedAddress.js";

describe("public port logic", () => {
  it("reports an open local port and a closed local port", async () => {
    const openServer = net.createServer();
    const closedServer = net.createServer();
    await new Promise<void>((resolve) => openServer.listen(0, "127.0.0.1", () => resolve()));
    await new Promise<void>((resolve) => closedServer.listen(0, "127.0.0.1", () => resolve()));
    const openAddress = openServer.address();
    const closedAddress = closedServer.address();
    if (!openAddress || typeof openAddress === "string" || !closedAddress || typeof closedAddress === "string") {
      throw new Error("The test listener did not start");
    }
    await new Promise<void>((resolve) => closedServer.close(() => resolve()));
    try {
      const report = await checkPublicPorts("127.0.0.1", [openAddress.port, closedAddress.port, 0, 70000]);
      assert.equal(report.address, "127.0.0.1");
      assert.equal(report.checks.length, 2);
      const open = report.checks.find((check) => check.port === openAddress.port);
      const closed = report.checks.find((check) => check.port === closedAddress.port);
      assert.equal(open?.result, PortReachabilityResult.Open);
      assert.equal(closed?.result, PortReachabilityResult.Closed);
    } finally {
      await new Promise<void>((resolve) => openServer.close(() => resolve()));
    }
  });

  it("checks this server when the company name points somewhere else", () => {
    const report = chooseCheckedAddress({
      hostname: "acme.com",
      resolvedAddress: "184.23.246.145",
      discoveredAddress: "9.9.9.9",
      localAddresses: ["192.168.1.20"]
    });
    assert.equal(report.address, "9.9.9.9");
    assert.match(report.source, /acme.com points at 184.23.246.145/);
  });

  it("uses the address record when that address is this server", () => {
    const report = chooseCheckedAddress({
      hostname: "mail.example.com",
      resolvedAddress: "9.9.9.9",
      discoveredAddress: "9.9.9.9",
      localAddresses: []
    });
    assert.equal(report.address, "9.9.9.9");
    assert.equal(report.source, "address record for mail.example.com");
  });

  it("keeps a local name unchecked when no public address answers", () => {
    const report = chooseCheckedAddress({
      hostname: "localhost",
      resolvedAddress: "",
      discoveredAddress: "",
      localAddresses: ["127.0.0.1"]
    });
    assert.equal(report.address, "");
    assert.match(report.source, /not a public hostname/);
  });

  it("reports listeners bound only to this machine without a public lookup", async () => {
    const started = Date.now();
    const report = await checkPublicPorts("acme.com", [25, 587], "127.0.0.1");
    assert.equal(report.address, "");
    assert.match(report.source, /127\.0\.0\.1/);
    assert.equal(report.checks.length, 2);
    assert.equal(report.checks.every((check) => check.result === PortReachabilityResult.Closed), true);
    assert.equal(Date.now() - started < 1000, true);
  });
});
