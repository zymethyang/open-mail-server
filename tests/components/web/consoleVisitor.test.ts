import assert from "node:assert/strict";
import os from "node:os";
import { describe, it } from "node:test";
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

function company(): Record<string, string> {
  return {
    organizationName: "Acme",
    domain: "acme.test",
    publicAddress: "1.2.3.4",
    displayName: "Ada Admin",
    address: "ada@acme.test",
    password: "correct-horse"
  };
}

describe("console visitor (no gate)", () => {
  it("lets a local visitor complete setup on first run, then returns 409", async () => {
    const consoleServer = await startWebConsole({ listenHost: "127.0.0.1" });
    try {
      const localFirst = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", company(), "", { connection: "close" });
      assert.equal(localFirst.status, 201);
      const localSecond = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", company(), "", { connection: "close" });
      assert.equal(localSecond.status, 409);
      assert.match(String(localSecond.payload.error), /already set up/);
    } finally {
      await consoleServer.stop();
    }
  });

  it("lets a remote visitor complete setup on first run, then returns 409", async () => {
    const address = otherLocalAddress();
    assert.ok(address, "This computer needs a network address to prove a remote visit can set up");
    const consoleServer = await startWebConsole({ listenHost: "0.0.0.0" });
    const port = new URL(consoleServer.baseUrl).port;
    const remoteUrl = `http://${address}:${port}`;
    try {
      const remoteFirst = await requestJson(remoteUrl, "POST", "/api/setup", company(), "", { connection: "close" });
      assert.equal(remoteFirst.status, 201);
      const remoteSecond = await requestJson(remoteUrl, "POST", "/api/setup", company(), "", { connection: "close" });
      assert.equal(remoteSecond.status, 409);
      assert.match(String(remoteSecond.payload.error), /already set up/);
    } finally {
      await consoleServer.stop();
    }
  });
});
