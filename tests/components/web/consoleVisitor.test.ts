import assert from "node:assert/strict";
import os from "node:os";
import { describe, it } from "node:test";
import { consoleAllowsVisitor, consoleVisitorIsLocal } from "../../../src/components/web/utils/consoleVisitor.js";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

function otherLocalAddress(): string {
  for (const records of Object.values(os.networkInterfaces())) {
    for (const record of records || []) {
      const family = String(record.family);
      if ((family === "IPv4" || family === "4") && !record.internal && !record.address.startsWith("169.254.")) {
        return record.address;
      }
    }
  }
  return "";
}

describe("console visitor", () => {
  it("treats only this machine as local before an account exists", () => {
    assert.equal(consoleVisitorIsLocal("127.0.0.1"), true);
    assert.equal(consoleVisitorIsLocal("::1"), true);
    assert.equal(consoleVisitorIsLocal("::ffff:127.0.0.1"), true);
    assert.equal(consoleVisitorIsLocal("127.0.0.2"), false);
    assert.equal(consoleVisitorIsLocal("203.0.113.10"), false);
    assert.equal(consoleAllowsVisitor("203.0.113.10", false), false);
    assert.equal(consoleAllowsVisitor("203.0.113.10", true), true);
    assert.equal(consoleAllowsVisitor("127.0.0.1", false), true);
  });

  it("refuses another computer until the company account exists", async () => {
    const address = otherLocalAddress();
    assert.ok(address, "This computer needs a network address to prove a remote visit is refused");
    const consoleServer = await startWebConsole({ listenHost: "0.0.0.0" });
    const port = new URL(consoleServer.baseUrl).port;
    const remoteUrl = `http://${address}:${port}`;
    const company = {
      organizationName: "Acme",
      domain: "acme.test",
      publicAddress: "1.2.3.4",
      displayName: "Ada Admin",
      address: "ada@acme.test",
      password: "correct-horse"
    };
    try {
      const remote = await requestJson(remoteUrl, "POST", "/api/setup", company, "", { connection: "close" });
      assert.equal(remote.status, 403);
      assert.match(String(remote.payload.error), /Create the company from this machine/);

      const local = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", company, "", { connection: "close" });
      assert.equal(local.status, 201);
      const remoteAfter = await requestJson(remoteUrl, "POST", "/api/setup", company, "", { connection: "close" });
      assert.equal(remoteAfter.status, 409);
    } finally {
      await consoleServer.stop();
    }
  });
});
