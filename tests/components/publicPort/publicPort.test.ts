import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import { describe, it } from "node:test";
import { addressForDnsRecords, checkPublicPorts, locatePublicAddress, publicAddressFromNetworkCards } from "../../../src/components/publicPort/index.js";
import { lanAddressFromRoute } from "../../../src/components/publicPort/utils/lanAddress.js";
import { PortReachabilityResult } from "../../../src/components/publicPort/enums/portReachabilityResult.js";
import { chooseCheckedAddress, isPublicInternetAddress } from "../../../src/components/publicPort/utils/checkedAddress.js";

function networkCard(address: string, family: os.NetworkInterfaceInfo["family"], internal = false): os.NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    family,
    mac: "00:00:00:00:00:00",
    internal,
    cidr: null,
    scopeid: 0
  } as os.NetworkInterfaceInfo;
}

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

  it("uses the public address on a network card and ignores private addresses", () => {
    const address = publicAddressFromNetworkCards({
      Loopback: [networkCard("127.0.0.1", "IPv4", true)],
      Private: [
        networkCard("10.1.1.1", "IPv4"),
        networkCard("172.16.4.4", "IPv4"),
        networkCard("192.168.1.20", "IPv4"),
        networkCard("100.64.1.1", "IPv4"),
        networkCard("169.254.1.1", "IPv4")
      ],
      Public: [networkCard("9.9.9.9", "IPv4"), networkCard("1.1.1.1", "IPv4"), networkCard("2001:db8::1", "IPv6")]
    });
    assert.equal(address, "1.1.1.1");
    assert.equal(publicAddressFromNetworkCards({ OnlyPrivate: [networkCard("192.168.56.1", "IPv4")] }), "");
  });

  it("uses the routed local address when no public address is available", async () => {
    const interfaces = {
      Loopback: [networkCard("127.0.0.1", "IPv4", true)],
      Virtual: [networkCard("192.168.56.1", "IPv4")],
      Office: [networkCard("192.168.1.90", "IPv4")],
      LinkLocal: [networkCard("169.254.4.4", "IPv4")]
    };
    assert.equal(lanAddressFromRoute("192.168.1.90", interfaces), "192.168.1.90");
    assert.equal(lanAddressFromRoute("127.0.0.1", interfaces), "192.168.1.90");
    assert.equal(lanAddressFromRoute("", { Loopback: [networkCard("127.0.0.1", "IPv4", true)] }), "");
    assert.equal(await addressForDnsRecords("149.28.152.245"), "149.28.152.245");
    const localAddress = await addressForDnsRecords("");
    const present = Object.values(os.networkInterfaces())
      .flatMap((entries) => entries || [])
      .some((entry) => entry.address === localAddress && !entry.internal);
    assert.equal(present, true);
    assert.equal(localAddress.startsWith("127."), false);
  });

  it("keeps the network card address when the company name points somewhere else", () => {
    const report = chooseCheckedAddress({
      hostname: "acme.com",
      resolvedAddress: "184.23.246.145",
      networkAddress: "9.9.9.9"
    });
    assert.equal(report.address, "9.9.9.9");
    assert.match(report.source, /acme.com points at 184.23.246.145/);
    assert.match(report.source, /network card is 9.9.9.9/);
  });

  it("uses the address record when that address is on a network card", () => {
    const report = chooseCheckedAddress({
      hostname: "mail.example.com",
      resolvedAddress: "9.9.9.9",
      networkAddress: "9.9.9.9"
    });
    assert.equal(report.address, "9.9.9.9");
    assert.equal(report.source, "address record for mail.example.com");
  });

  it("reports a network card address when the name has no address record", () => {
    const report = chooseCheckedAddress({
      hostname: "mail.example.com",
      resolvedAddress: "",
      networkAddress: "9.9.9.9"
    });
    assert.equal(report.address, "9.9.9.9");
    assert.equal(report.source, "public address on a network card");
  });

  it("keeps a configured literal address", () => {
    const report = chooseCheckedAddress({
      hostname: "203.0.113.10",
      resolvedAddress: "",
      networkAddress: "9.9.9.9"
    });
    assert.equal(report.address, "203.0.113.10");
    assert.equal(report.source, "configured address");
  });

  it("keeps a local name unchecked when no network card has a public address", () => {
    const report = chooseCheckedAddress({
      hostname: "localhost",
      resolvedAddress: "",
      networkAddress: ""
    });
    assert.equal(report.address, "");
    assert.match(report.source, /no network card has a public address/);
  });

  it("does not ask another service for the public address", async () => {
    const started = Date.now();
    const located = await locatePublicAddress("mail.acme.test");
    assert.equal(Date.now() - started < 1000, true);
    assert.equal(located.source.toLowerCase().includes("internet"), false);
    if (located.address) {
      assert.equal(isPublicInternetAddress(located.address), true);
      assert.equal(located.source, "public address on a network card");
    } else {
      assert.match(located.source, /network card/);
    }
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
