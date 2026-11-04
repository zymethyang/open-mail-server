import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { describe, it } from "node:test";
import { describeCertificateMaterial, loadCertificate, storeCertificateMaterial } from "../../src/components/certificate/index.js";
import { generateSelfSignedCertificate } from "../../src/components/certificate/utils/selfSignedCertificate.js";

describe("certificate logic", () => {
  it("creates a certificate the server can load again", async () => {
    const storageDirectory = await mkdtemp(path.join(os.tmpdir(), "email-server-certificate-"));
    try {
      const loaded = await loadCertificate(storageDirectory, ["acme.test"]);
      const again = await loadCertificate(storageDirectory, ["other.test"]);
      assert.equal(again.certificate, loaded.certificate);
      assert.equal(again.privateKey, loaded.privateKey);
      tls.createSecureContext({ key: loaded.privateKey, cert: loaded.certificate });
      const parsed = new crypto.X509Certificate(loaded.certificate);
      assert.match(`${parsed.subject} ${parsed.subjectAltName || ""}`, /acme\.test/);
      assert.match(parsed.subjectAltName || "", /localhost/);
    } finally {
      await rm(storageDirectory, { recursive: true, force: true });
    }
  });

  it("stores an uploaded certificate and rejects a key that does not match", async () => {
    const storageDirectory = await mkdtemp(path.join(os.tmpdir(), "email-server-certificate-"));
    try {
      await loadCertificate(storageDirectory, ["localhost"]);
      const generated = generateSelfSignedCertificate(["mail.acme.test"]);
      const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      const otherKey = other.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      assert.throws(() => describeCertificateMaterial(generated.certificate, otherKey), /does not match/);
      const description = await storeCertificateMaterial(storageDirectory, generated.certificate, generated.privateKey);
      assert.equal(description.selfSigned, true);
      assert.ok(description.names.includes("mail.acme.test"));
      const loaded = await loadCertificate(storageDirectory, ["localhost"]);
      assert.equal(loaded.certificate.trim(), generated.certificate.trim());
      assert.equal(loaded.privateKey.trim(), generated.privateKey.trim());
    } finally {
      await rm(storageDirectory, { recursive: true, force: true });
    }
  });
});
