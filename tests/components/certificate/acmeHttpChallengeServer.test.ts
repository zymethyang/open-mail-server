import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AcmeChallengeStore } from "../../../src/components/certificate/utils/acmeChallengeStore.js";
import { startAcmeHttpChallengeServer } from "../../../src/components/certificate/utils/acmeHttpChallengeServer.js";

describe("ACME HTTP-01 challenge server", () => {
  it("serves only the challenge path and returns 404 elsewhere", async () => {
    const store = new AcmeChallengeStore();
    store.set("token-one", "token-one.authorization");
    const started = await startAcmeHttpChallengeServer(store, "127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${started.port}`;
    try {
      const allowed = await fetch(`${baseUrl}/.well-known/acme-challenge/token-one`);
      assert.equal(allowed.status, 200);
      assert.equal(await allowed.text(), "token-one.authorization");
      const head = await fetch(`${baseUrl}/.well-known/acme-challenge/token-one`, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), "");
      const missing = await fetch(`${baseUrl}/.well-known/acme-challenge/missing`);
      assert.equal(missing.status, 404);
      const other = await fetch(`${baseUrl}/`);
      assert.equal(other.status, 404);
      const consolePath = await fetch(`${baseUrl}/admin/settings`);
      assert.equal(consolePath.status, 404);
      const posted = await fetch(`${baseUrl}/.well-known/acme-challenge/token-one`, { method: "POST", body: "no" });
      assert.equal(posted.status, 404);
      const traversal = await fetch(`${baseUrl}/.well-known/acme-challenge/../token-one`);
      assert.equal(traversal.status, 404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        started.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
