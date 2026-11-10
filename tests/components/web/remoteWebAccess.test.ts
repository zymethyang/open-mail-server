import assert from "node:assert/strict";
import os from "node:os";
import { after, describe, it } from "node:test";
import { startEmailServer } from "../../../src/components/emailServer/index.js";
import type { RunningEmailServer } from "../../../src/components/emailServer/interfaces/runningEmailServer.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { testConfiguration } from "../../support/testConfiguration.js";

describe("web console from another computer", { concurrency: 1 }, () => {
  let running: RunningEmailServer | undefined;
  let storageDirectory = "";
  let baseUrl = "";

  after(async () => {
    await running?.stop();
    if (storageDirectory) {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("serves the console, signs in, and keeps a session when the address is not this machine", async () => {
    storageDirectory = await createTemporaryStorage();
    const configuration = testConfiguration(storageDirectory);
    configuration.host = "0.0.0.0";
    configuration.configuredDomain = "";
    running = await startEmailServer({ configuration });
    const listener = running.listeners.find((item) => item.name === "Web" && item.started);
    assert.ok(listener, "The web console did not start");
    const address = networkAddresses()[0];
    assert.ok(address, "This computer has no network address for another computer to use");
    baseUrl = `http://${address}:${listener.port}`;
    const localUrl = `http://127.0.0.1:${listener.port}`;

    const blocked = await fetch(`${baseUrl}/`);
    assert.equal(blocked.status, 403);
    const blockedSetup = await fetch(`${baseUrl}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "149.28.152.245",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      })
    });
    assert.equal(blockedSetup.status, 403);

    const setup = await fetch(`${localUrl}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: localUrl },
      body: JSON.stringify({
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "149.28.152.245",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      })
    });
    assert.equal(setup.status, 201);

    const home = await fetch(`${baseUrl}/`);
    const html = await home.text();
    assert.equal(home.status, 200);
    assert.equal(html.includes("Open Mail Server"), true);
    assert.equal((await fetch(`${baseUrl}/styles/base.css`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/client/index.js`)).status, 200);

    const rejectedOrigin = await fetch(`${baseUrl}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body: JSON.stringify({ address: "ada@acme.test", password: "correct-horse" })
    });
    assert.equal(rejectedOrigin.status, 403);

    const wrongPassword = await fetch(`${baseUrl}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ address: "ada@acme.test", password: "wrong-horse" })
    });
    assert.equal(wrongPassword.status, 401);

    const signedIn = await fetch(`${baseUrl}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ address: "ada@acme.test", password: "correct-horse" })
    });
    assert.equal(signedIn.status, 200);
    const cookie = (signedIn.headers.getSetCookie?.() || []).find((line) => line.startsWith("session=")) || "";
    assert.match(cookie, /^session=/);
    assert.equal(cookie.includes("Secure"), false);

    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, { headers: { Cookie: cookie.split(";")[0] } });
    const payload = (await bootstrap.json()) as { account?: { address?: string; role?: string } };
    assert.equal(bootstrap.status, 200);
    assert.equal(payload.account?.address, "ada@acme.test");
    assert.equal(payload.account?.role, "administrator");

    const folders = await fetch(`${baseUrl}/api/folders`, {
      headers: { Cookie: cookie.split(";")[0], Origin: baseUrl }
    });
    assert.equal(folders.status, 200);
  });
});

function networkAddresses(): string[] {
  const addresses: string[] = [];
  for (const records of Object.values(os.networkInterfaces())) {
    for (const record of records || []) {
      const family = String(record.family);
      const linkLocal = record.address.startsWith("169.254.");
      if ((family !== "IPv4" && family !== "4") || record.internal || linkLocal || addresses.includes(record.address)) {
        continue;
      }
      addresses.push(record.address);
    }
  }
  return addresses;
}
