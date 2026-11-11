import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { describe, it } from "node:test";
import { ensureSelfSignedCertificate } from "../../../src/components/certificate/index.js";
import { generateAuthoritySignedCertificate, generateSelfSignedCertificate } from "../../../src/components/certificate/utils/selfSignedCertificate.js";
import { storeCertificateMaterial } from "../../../src/components/certificate/utils/storedCertificate.js";
import { certificateCoversNames, certificateRenewal, selfSignedCertificateNeedsRenewal } from "../../../src/components/certificate/utils/renewal.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";

describe("certificate renewal", () => {
  it("reports the days remaining and the renewal window", () => {
    const now = Date.parse("2026-11-11T00:00:00.000Z");
    assert.deepEqual(certificateRenewal("Nov 20 00:00:00 2026 GMT", now), { daysRemaining: 9, renewalRequired: true });
    assert.equal(certificateRenewal("Nov 11 2027 00:00:00 GMT", now).renewalRequired, false);
    assert.equal(certificateRenewal("not-a-date").renewalRequired, true);
  });

  it("renews a self-signed certificate that is near expiry and keeps an uploaded certificate", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      const generated = generateSelfSignedCertificate(["acme.test"]);
      const expires = Date.parse(new X509Certificate(generated.certificate).validTo);
      assert.equal(selfSignedCertificateNeedsRenewal(generated.certificate, expires - 20 * 24 * 60 * 60 * 1000), false);
      assert.equal(selfSignedCertificateNeedsRenewal(generated.certificate, expires - 10 * 24 * 60 * 60 * 1000), true);
      assert.equal(certificateCoversNames(generated.certificate, ["acme.test", "localhost"]), true);
      assert.equal(certificateCoversNames(generated.certificate, ["missing.test"]), false);

      const first = await ensureSelfSignedCertificate(storageDirectory, ["acme.test"]);
      const second = await ensureSelfSignedCertificate(storageDirectory, ["other.test"]);
      assert.equal(second.certificate, first.certificate);

      const renewed = await ensureSelfSignedCertificate(storageDirectory, ["acme.test"], expires);
      assert.notEqual(renewed.certificate, first.certificate);
      assert.equal(selfSignedCertificateNeedsRenewal(renewed.certificate, Date.now()), false);

      const authority = generateAuthoritySignedCertificate(["clients.example"]);
      await storeCertificateMaterial(storageDirectory, authority.certificate, authority.privateKey, authority.intermediateCertificate);
      const kept = await ensureSelfSignedCertificate(storageDirectory, ["different.test"]);
      assert.equal(kept.certificate.includes(authority.certificate), true);
      assert.equal(selfSignedCertificateNeedsRenewal(authority.certificate), false);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
