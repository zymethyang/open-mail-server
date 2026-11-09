import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SettingsRepository } from "../../../src/components/settings/index.js";
import type { SettingsRepository as SettingsRepositoryContract } from "../../../src/components/settings/interfaces/settings.js";
import { RelaySecurity } from "../../../src/components/settings/enums/relaySecurity.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { statusCodeOf } from "../../support/statusCode.js";

describe("settings repository interface", () => {
  it("hides the relay password and keeps it when an update omits a new one", async () => {
    const storageDirectory = await createTemporaryStorage();
    const repository: SettingsRepositoryContract = new SettingsRepository(storageDirectory);
    try {
      const initial = await repository.read();
      assert.equal(initial.relay.enabled, false);
      assert.equal(initial.relay.port, 587);
      assert.equal(initial.relay.security, RelaySecurity.StartTls);
      assert.equal(initial.listenersSaved, false);
      assert.equal(initial.listeners.host, "0.0.0.0");
      assert.equal(initial.listeners.webPort, 443);
      assert.equal(initial.listeners.smtpPort, 25);
      assert.equal(repository.present(initial).secureWeb, true);

      await assert.rejects(
        () =>
          repository.update({
            publicHostname: "bad host",
            relay: { enabled: false, host: "", port: 587, username: "", password: "", security: RelaySecurity.StartTls }
          }),
        (error: unknown) => statusCodeOf(error) === 400
      );
      await assert.rejects(
        () =>
          repository.update({
            publicHostname: "",
            relay: { enabled: true, host: "", port: 587, username: "", password: "", security: RelaySecurity.StartTls }
          }),
        (error: unknown) => statusCodeOf(error) === 400
      );
      await assert.rejects(
        () =>
          repository.update({
            publicHostname: "",
            relay: { enabled: false, host: "smtp.example.test", port: 0, username: "", password: "", security: RelaySecurity.StartTls }
          }),
        (error: unknown) => statusCodeOf(error) === 400
      );
      await assert.rejects(
        () =>
          repository.update({
            publicHostname: "",
            relay: { enabled: false, host: "", port: 587, username: "", password: "", security: "open" as RelaySecurity }
          }),
        (error: unknown) => statusCodeOf(error) === 400
      );

      await assert.rejects(
        () =>
          repository.update({
            publicHostname: "",
            relay: { enabled: false, host: "smtp.example.test", port: 25, username: "", password: "", security: RelaySecurity.Plain }
          }),
        (error: unknown) => statusCodeOf(error) === 400
      );
      await assert.rejects(
        () =>
          repository.update({
            publicHostname: "",
            relay: { enabled: false, host: "smtp.example.test", port: 587, username: "", password: "", security: RelaySecurity.Tls }
          }),
        (error: unknown) => statusCodeOf(error) === 400
      );

      const saved = await repository.update({
        publicHostname: "Mail.Acme.Test.",
        relay: {
          enabled: true,
          host: "smtp.example.test",
          port: 465,
          username: "ada",
          password: "secret-relay",
          security: RelaySecurity.Tls
        }
      });
      assert.equal(saved.publicHostname, "mail.acme.test");
      assert.equal(saved.relay.port, 465);
      assert.equal(saved.relay.passwordSaved, true);
      assert.equal("password" in saved.relay, false);
      assert.equal(saved.secureWeb, true);
      const stored = await repository.read();
      assert.equal(stored.relay.password, "secret-relay");
      assert.equal(stored.relay.security, RelaySecurity.Tls);
      assert.equal(stored.listeners.host, "0.0.0.0");
      assert.equal(stored.listeners.webPort, 443);

      const kept = await repository.update({
        publicHostname: "",
        relay: { enabled: false, host: "10.1.2.3", port: 587, username: "ada", password: "", security: RelaySecurity.StartTls }
      });
      assert.equal(kept.relay.host, "10.1.2.3");
      assert.equal(kept.relay.passwordSaved, true);
      assert.equal((await repository.read()).relay.password, "secret-relay");
      assert.equal((await repository.read()).listenersSaved, false);
      assert.equal((await repository.read()).listeners.smtpPort, 25);

      const secureWeb = await repository.update({
        publicHostname: "mail.acme.test",
        relay: { enabled: false, host: "10.1.2.3", port: 587, username: "ada", password: "", security: RelaySecurity.StartTls },
        secureWeb: true
      });
      assert.equal(secureWeb.secureWeb, true);
      assert.equal((await repository.read()).listeners.host, "0.0.0.0");
      assert.equal((await repository.read()).listeners.webPort, 443);
      assert.equal((await repository.read()).listeners.smtpPort, 25);
      const keptSecureWeb = await repository.update({
        publicHostname: "",
        relay: { enabled: false, host: "", port: 587, username: "", password: "", security: RelaySecurity.StartTls }
      });
      assert.equal(keptSecureWeb.secureWeb, true);
      assert.equal((await repository.read()).listenersSaved, true);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
