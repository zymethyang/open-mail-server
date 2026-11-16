import assert from "node:assert/strict";
import { access, constants, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { AcmeChallengeStore } from "../../../src/components/certificate/utils/acmeChallengeStore.js";
import { createAcmeAccountKey } from "../../../src/components/certificate/utils/acmeJose.js";
import { isAcmeManagedCertificate } from "../../../src/components/certificate/utils/acmeProvenance.js";
import { AcmeCertificateService } from "../../../src/components/certificate/utils/acmeService.js";
import { generateAuthoritySignedCertificate, generateSelfSignedCertificate } from "../../../src/components/certificate/utils/selfSignedCertificate.js";
import { describeStoredCertificate, storeCertificateMaterial } from "../../../src/components/certificate/utils/storedCertificate.js";
import { ensureSelfSignedCertificate } from "../../../src/components/certificate/index.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";

describe("ACME certificate service", () => {
  it("issues and renews with a stub issuer, keeps key mode private, and refuses renew for uploads", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      const challengeStore = new AcmeChallengeStore();
      let issueCount = 0;
      const service = new AcmeCertificateService({
        storageDirectory,
        challengeStore,
        resolveHostname: async () => "mail.example.com",
        resolveContactEmail: async () => "admin@example.com",
        activateCertificate: async () => undefined,
        issuer: async ({ hostname, challengeStore: store }) => {
          issueCount += 1;
          store.set("stub-token", "stub-token.value");
          const issued = generateAuthoritySignedCertificate([hostname]);
          const account = createAcmeAccountKey();
          return {
            certificatePem: `${issued.certificate}${issued.intermediateCertificate}`,
            privateKeyPem: issued.privateKey,
            accountKeyPem: account.privateKeyPem,
            accountUrl: "https://acme.test/account/1"
          };
        }
      });
      const issued = await service.issue();
      assert.equal(issued.acmeManaged, true);
      assert.equal(issued.selfSigned, false);
      assert.equal(await isAcmeManagedCertificate(storageDirectory), true);
      assert.equal(challengeStore.get("stub-token"), undefined);
      await access(path.join(storageDirectory, "certificates", "private-key.pem"), constants.R_OK);
      await access(path.join(storageDirectory, "certificates", "acme-account-key.pem"), constants.R_OK);
      const description = await describeStoredCertificate(storageDirectory);
      assert.equal(description.acmeManaged, true);
      assert.equal(JSON.stringify(description).includes("BEGIN PRIVATE KEY"), false);
      const renewed = await service.renew();
      assert.equal(renewed.acmeManaged, true);
      assert.equal(issueCount, 2);

      const uploaded = generateAuthoritySignedCertificate(["upload.example.com"]);
      await storeCertificateMaterial(storageDirectory, uploaded.certificate, uploaded.privateKey, uploaded.intermediateCertificate);
      assert.equal(await isAcmeManagedCertificate(storageDirectory), false);
      await assert.rejects(() => service.renew(), /Only a Let’s Encrypt certificate/);

      const kept = await ensureSelfSignedCertificate(storageDirectory, ["other.example.com"]);
      assert.equal(kept.certificate.includes(uploaded.certificate.trim()), true);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("fails closed for .test hostnames without calling the issuer", async () => {
    const storageDirectory = await createTemporaryStorage();
    let called = false;
    const service = new AcmeCertificateService({
      storageDirectory,
      challengeStore: new AcmeChallengeStore(),
      resolveHostname: async () => "qa-local.test",
      resolveContactEmail: async () => "admin@qa-local.test",
      activateCertificate: async () => undefined,
      issuer: async () => {
        called = true;
        throw new Error("should not run");
      }
    });
    try {
      await assert.rejects(() => service.issue(), /test domains/);
      assert.equal(called, false);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("does not replace an uploaded certificate with self-signed renewal", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      const uploaded = generateAuthoritySignedCertificate(["clients.example.com"]);
      await storeCertificateMaterial(storageDirectory, uploaded.certificate, uploaded.privateKey, uploaded.intermediateCertificate);
      const before = await readFile(path.join(storageDirectory, "certificates", "certificate.pem"), "utf8");
      const kept = await ensureSelfSignedCertificate(storageDirectory, ["clients.example.com"], Date.now() + 1000);
      const after = await readFile(path.join(storageDirectory, "certificates", "certificate.pem"), "utf8");
      assert.equal(after, before);
      assert.equal(kept.certificate, before);
      const selfSigned = generateSelfSignedCertificate(["self.example.com"]);
      assert.ok(selfSigned.certificate);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
