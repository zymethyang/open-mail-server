import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { configurationWithListeners, loadConfiguration } from "../../src/components/configuration/index.js";
import {
  defaultBindHost,
  defaultMaximumMessageBytes,
  defaultSecureWeb,
  defaultSmtpPort,
  defaultStorageDirectoryName,
  defaultWebPort,
  productName
} from "../../src/components/configuration/constants/serverDefaults.js";
import { projectDirectoryFrom } from "../../src/components/configuration/utils/projectDirectory.js";

describe("configuration logic", () => {
  it("finds the project directory and rejects a path outside a project", async () => {
    const projectDirectory = projectDirectoryFrom(import.meta.url);
    assert.equal(path.basename(projectDirectory), "email-server");
    const outside = await mkdtemp(path.join(os.tmpdir(), "email-server-outside-"));
    assert.throws(() => projectDirectoryFrom(pathToFileURL(path.join(outside, "file.ts")).href), /project directory/);
  });

  it("keeps the bind address and ports fixed when web security is saved", () => {
    const defaults = loadConfiguration();
    const projectDirectory = projectDirectoryFrom(import.meta.url);
    assert.equal(defaults.host, defaultBindHost);
    assert.equal(defaults.webPort, defaultWebPort);
    assert.equal(defaults.smtpPort, defaultSmtpPort);
    assert.equal(defaults.productName, productName);
    assert.equal(defaults.configuredDomain, "");
    assert.equal(defaults.publicHostname, "");
    assert.equal(defaults.secureWeb, defaultSecureWeb);
    assert.equal(defaults.maximumMessageBytes, defaultMaximumMessageBytes);
    assert.equal(defaults.storageDirectory, path.join(projectDirectory, defaultStorageDirectoryName));

    const selected = configurationWithListeners(defaults, {
      host: "127.0.0.1",
      webPort: 8080,
      smtpPort: 2525,
      smtpSecurePort: 2465,
      smtpSubmissionPort: 2587,
      imapPort: 2143,
      imapSecurePort: 2993,
      pop3Port: 2110,
      pop3SecurePort: 2995,
      secureWeb: true
    });
    assert.equal(selected.host, defaultBindHost);
    assert.equal(selected.webPort, defaultWebPort);
    assert.equal(selected.smtpPort, defaultSmtpPort);
    assert.equal(selected.secureWeb, true);
    assert.equal(selected.storageDirectory, defaults.storageDirectory);
    assert.equal(selected.productName, productName);
  });
});
