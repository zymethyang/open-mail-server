import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAcmeAccountKey } from "../../../src/components/certificate/utils/acmeJose.js";
import { generateAuthoritySignedCertificate } from "../../../src/components/certificate/utils/selfSignedCertificate.js";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

describe("certificate ACME admin API", () => {
  it("issues with the stub, enforces admin and CSRF, and hides private keys", async () => {
    const consoleServer = await startWebConsole({
      acmeIssuer: async ({ hostname, challengeStore }) => {
        challengeStore.set("api-token", "api-token.value");
        const issued = generateAuthoritySignedCertificate([hostname]);
        const account = createAcmeAccountKey();
        return {
          certificatePem: `${issued.certificate}${issued.intermediateCertificate}`,
          privateKeyPem: issued.privateKey,
          accountKeyPem: account.privateKeyPem,
          accountUrl: "https://acme.test/account/api"
        };
      }
    });
    try {
      const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "203.0.113.10",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      });
      assert.equal(setup.status, 201);
      const cookie = setup.cookieHeader;
      await requestJson(
        consoleServer.baseUrl,
        "PUT",
        "/api/admin/settings",
        {
          publicHostname: "mail.example.com",
          relay: { enabled: false, host: "", port: 587, security: "starttls", username: "", password: "" }
        },
        cookie
      );

      const member = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/admin/mailboxes",
        { displayName: "Member", address: "member@acme.test", password: "member-horse-1" },
        cookie
      );
      assert.equal(member.status, 201);
      const memberSession = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
        address: "member@acme.test",
        password: "member-horse-1"
      });
      assert.equal(memberSession.status, 200);

      const memberIssue = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/certificate/acme/issue", {}, memberSession.cookieHeader);
      assert.equal(memberIssue.status, 403);

      const csrfBlocked = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/admin/certificate/acme/issue",
        {},
        cookie,
        { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }
      );
      assert.equal(csrfBlocked.status, 403);

      const issued = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/certificate/acme/issue", {}, cookie);
      assert.equal(issued.status, 200);
      const certificate = issued.payload.certificate as Record<string, unknown>;
      assert.equal(certificate.acmeManaged, true);
      assert.equal(JSON.stringify(issued.payload).includes("BEGIN PRIVATE KEY"), false);
      assert.equal(JSON.stringify(issued.payload).includes("BEGIN EC PRIVATE KEY"), false);

      const renewed = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/certificate/acme/renew", {}, cookie);
      assert.equal(renewed.status, 200);
      assert.equal((renewed.payload.certificate as Record<string, unknown>).acmeManaged, true);

      await requestJson(
        consoleServer.baseUrl,
        "PUT",
        "/api/admin/settings",
        {
          publicHostname: "",
          relay: { enabled: false, host: "", port: 587, security: "starttls", username: "", password: "" }
        },
        cookie
      );
      const testDomainRejected = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/certificate/acme/issue", {}, cookie);
      assert.equal(testDomainRejected.status, 400);
      assert.match(String(testDomainRejected.payload.error || ""), /test domains|hostname|Let’s Encrypt/i);
    } finally {
      await consoleServer.stop();
    }
  });
});
