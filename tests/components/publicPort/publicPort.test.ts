import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";
import { checkedAddressReport, checkPublicPorts } from "../../../src/components/publicPort/index.js";
import { PortReachabilityResult } from "../../../src/components/publicPort/enums/portReachabilityResult.js";
import { assertPublicAddress, isPublicInternetAddress } from "../../../src/components/publicPort/utils/checkedAddress.js";
import { statusCodeOf } from "../../support/statusCode.js";

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

  it("accepts a public address and rejects a private or local address", () => {
    assert.equal(assertPublicAddress("  203.0.113.10  "), "203.0.113.10");
    assert.equal(assertPublicAddress("2606:4700:4700::1111"), "2606:4700:4700::1111");
    assert.equal(isPublicInternetAddress("9.9.9.9"), true);
    assert.equal(isPublicInternetAddress("8.8.8.8"), true);
    for (const address of [
      "",
      "mail.example.com",
      "10.1.1.1",
      "172.16.4.4",
      "192.168.1.20",
      "100.64.1.1",
      "169.254.1.1",
      "127.0.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "ff02::1",
      "2001:db8::1",
      "::ffff:8.8.8.8"
    ]) {
      assert.equal(isPublicInternetAddress(address), false, address);
      assert.throws(
        () => assertPublicAddress(address),
        (error: unknown) => statusCodeOf(error) === 400 && /public IP address/.test((error as Error).message)
      );
    }
  });

  it("describes the address entered for this server", () => {
    assert.deepEqual(checkedAddressReport("203.0.113.10"), {
      address: "203.0.113.10",
      source: "public IP address entered for this server"
    });
    assert.deepEqual(checkedAddressReport("2606:4700:4700::1111"), {
      address: "2606:4700:4700::1111",
      source: "public IP address entered for this server"
    });
    assert.equal(checkedAddressReport("").source, "No public IP address has been entered.");
    assert.equal(checkedAddressReport("mail.acme.test").address, "");
    assert.equal(checkedAddressReport("mail.acme.test").source.includes("network card"), false);
  });

  it("does not look up a hostname or a network card", async () => {
    const started = Date.now();
    const report = await checkPublicPorts("mail.acme.test", [25, 587]);
    assert.equal(Date.now() - started < 500, true);
    assert.equal(report.address, "");
    assert.equal(report.source, "No public IP address has been entered.");
    assert.equal(report.source.includes("network card"), false);
    assert.equal(report.checks.length, 2);
    assert.equal(report.checks.every((check) => check.result === PortReachabilityResult.Unknown), true);
  });

  it("reports listeners bound only to this machine without a public lookup", async () => {
    const started = Date.now();
    const report = await checkPublicPorts("203.0.113.10", [25, 587], "127.0.0.1");
    assert.equal(report.address, "");
    assert.match(report.source, /127\.0\.0\.1/);
    assert.equal(report.checks.length, 2);
    assert.equal(report.checks.every((check) => check.result === PortReachabilityResult.Closed), true);
    assert.equal(Date.now() - started < 1000, true);
  });
});
