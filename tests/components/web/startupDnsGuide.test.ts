import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OrganizationRepository } from "../../../src/components/organization/index.js";
import { RelaySecurity } from "../../../src/components/settings/enums/relaySecurity.js";
import { SettingsRepository } from "../../../src/components/settings/index.js";
import { readStoredDnsGuide } from "../../../src/components/web/utils/startupDnsGuide.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { testConfiguration } from "../../support/testConfiguration.js";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

describe("startup DNS guide", { concurrency: 1 }, () => {
  it("stays empty until the company exists and then uses the saved public name", async () => {
    const storageDirectory = await createTemporaryStorage();
    const configuration = testConfiguration(storageDirectory);
    try {
      assert.equal(await readStoredDnsGuide(configuration), null);
      await new OrganizationRepository(storageDirectory).create({
        domain: "acme.test",
        displayName: "Acme",
        requiredDomain: "acme.test",
        publicAddress: "1.2.3.4",
        administratorAddress: "ada@acme.test"
      });
      const firstGuide = await readStoredDnsGuide(configuration);
      assert.equal(firstGuide?.domain, "acme.test");
      assert.match(firstGuide?.zoneFile || "", /acme\.test\.\t300\tIN\tA\t1\.2\.3\.4/);
      assert.match(firstGuide?.zoneFile || "", /IN\tMX\t10 acme\.test\./);
      assert.match(firstGuide?.zoneFile || "", /v=spf1 ip4:1\.2\.3\.4 ~all/);
      assert.match(firstGuide?.zoneFile || "", /v=DKIM1/);
      assert.match(firstGuide?.zoneFile || "", /rua=mailto:ada@acme\.test/);

      await new SettingsRepository(storageDirectory).update({
        publicHostname: "mail.acme.test",
        relay: { enabled: false, host: "", port: 587, username: "", password: "", security: RelaySecurity.StartTls }
      });
      const namedGuide = await readStoredDnsGuide({ ...configuration, publicHostname: "ignored.example" });
      assert.match(namedGuide?.zoneFile || "", /mail\.acme\.test\.\t300\tIN\tA\t1\.2\.3\.4/);
      assert.match(namedGuide?.zoneFile || "", /IN\tMX\t10 mail\.acme\.test\./);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("writes the DNS guide to the terminal when the company is created", async () => {
    const consoleServer = await startWebConsole();
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...parts: unknown[]) => {
      lines.push(parts.map((part) => String(part)).join(" "));
    };
    try {
      const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "1.2.3.4",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      });
      assert.equal(setup.status, 201);
      const text = lines.join("\n");
      assert.match(text, /DNS records for acme\.test/);
      assert.match(text, /Publish these records at the company DNS host/);
      assert.match(text, /127\.0\.0\.1\.\t300\tIN\tA\t1\.2\.3\.4/);
      assert.match(text, /IN\tMX\t10 127\.0\.0\.1\./);
      assert.match(text, /v=spf1 ip4:1\.2\.3\.4 ~all/);
      assert.match(text, /v=DKIM1/);
      assert.match(text, /rua=mailto:ada@acme\.test/);
    } finally {
      console.log = originalLog;
      await consoleServer.stop();
    }
  });
});
