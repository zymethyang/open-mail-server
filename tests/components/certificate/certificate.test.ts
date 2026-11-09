import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { describe, it } from "node:test";
import { describeCertificateMaterial, ensureSelfSignedCertificate, loadCertificate, prepareCertificateMaterial, storeCertificateMaterial } from "../../../src/components/certificate/index.js";
import { generateAuthoritySignedCertificate, generateSelfSignedCertificate } from "../../../src/components/certificate/utils/selfSignedCertificate.js";

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
      assert.match(parsed.subjectAltName || "", /DNS:localhost/);
      assert.match(parsed.subjectAltName || "", /IP Address:127\.0\.0\.1/);
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

  it("puts internet addresses in a new certificate and keeps a certificate that is already stored", async () => {
    const generated = generateSelfSignedCertificate(["acme.test", "192.168.1.20"]);
    const parsed = new crypto.X509Certificate(generated.certificate);
    assert.match(parsed.subjectAltName || "", /DNS:acme\.test/);
    assert.match(parsed.subjectAltName || "", /IP Address:192\.168\.1\.20/);
    assert.match(parsed.subjectAltName || "", /IP Address:127\.0\.0\.1/);
    const storageDirectory = await mkdtemp(path.join(os.tmpdir(), "email-server-certificate-"));
    try {
      const created = await loadCertificate(storageDirectory, ["localhost"]);
      const storedBefore = await readFile(path.join(storageDirectory, "certificates", "certificate.pem"), "utf8");
      const kept = await ensureSelfSignedCertificate(storageDirectory, ["acme.test", "192.168.1.20"]);
      const again = await ensureSelfSignedCertificate(storageDirectory, ["mail.example.test"]);
      const storedAfter = await readFile(path.join(storageDirectory, "certificates", "certificate.pem"), "utf8");
      assert.equal(kept.certificate, created.certificate);
      assert.equal(again.certificate, created.certificate);
      assert.equal(storedAfter, storedBefore);
      assert.equal(new crypto.X509Certificate(kept.certificate).subjectAltName?.includes("DNS:acme.test") || false, false);
    } finally {
      await rm(storageDirectory, { recursive: true, force: true });
    }
  });

  it("keeps a provider certificate chain and serves it without the root", async () => {
    const issued = generateAuthoritySignedCertificate(["mail.acme.test"]);
    const root = new crypto.X509Certificate(issued.rootCertificate);
    const intermediate = new crypto.X509Certificate(issued.intermediateCertificate);
    const leaf = new crypto.X509Certificate(issued.certificate);
    assert.equal(root.ca, true);
    assert.equal(intermediate.ca, true);
    assert.equal(leaf.ca, false);
    assert.equal(leaf.verify(intermediate.publicKey), true);
    assert.equal(intermediate.verify(root.publicKey), true);
    assert.throws(
      () => prepareCertificateMaterial(issued.certificate, issued.privateKey),
      /Include the intermediate certificates/
    );
    const other = generateAuthoritySignedCertificate(["other.test"]);
    assert.throws(
      () => prepareCertificateMaterial(issued.certificate, issued.privateKey, other.intermediateCertificate),
      /Include the intermediate certificates/
    );

    const storageDirectory = await mkdtemp(path.join(os.tmpdir(), "email-server-certificate-"));
    try {
      const separate = await storeCertificateMaterial(storageDirectory, issued.certificate, issued.privateKey, issued.intermediateCertificate);
      assert.equal(separate.selfSigned, false);
      assert.equal(separate.intermediateCount, 1);
      assert.ok(separate.names.includes("mail.acme.test"));
      const combined = `${issued.rootCertificate}${issued.intermediateCertificate}${issued.certificate}`;
      const fromOneFile = prepareCertificateMaterial(combined, issued.privateKey);
      assert.equal(fromOneFile.description.intermediateCount, 1);
      assert.equal((fromOneFile.certificate.match(/BEGIN CERTIFICATE/g) || []).length, 2);
      assert.match(fromOneFile.certificate, /BEGIN CERTIFICATE/);
      const blocks = fromOneFile.certificate.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
      assert.equal(blocks.length, 2);
      assert.equal(new crypto.X509Certificate(blocks[0] || "").checkPrivateKey(crypto.createPrivateKey(issued.privateKey)), true);
      assert.match(new crypto.X509Certificate(blocks[1] || "").subject, /Example Intermediate Authority/);

      const leafOnly = tls.createServer({ key: issued.privateKey, cert: issued.certificate, minVersion: "TLSv1.2" });
      const withChain = tls.createServer({ key: issued.privateKey, cert: fromOneFile.certificate, minVersion: "TLSv1.2" });
      leafOnly.on("secureConnection", (socket) => socket.end());
      withChain.on("secureConnection", (socket) => socket.end());
      const leafPort = await listen(leafOnly);
      const chainPort = await listen(withChain);
      await assert.rejects(connectWithRoot(leafPort, issued.rootCertificate), /unable to verify|certificate/);
      await connectWithRoot(chainPort, issued.rootCertificate);
      leafOnly.close();
      withChain.close();

      const storedBefore = await readFile(path.join(storageDirectory, "certificates", "certificate.pem"), "utf8");
      const kept = await ensureSelfSignedCertificate(storageDirectory, ["missing.example", "192.168.1.50"]);
      assert.equal(kept.certificate, storedBefore);
      assert.equal(new crypto.X509Certificate(kept.certificate).subject.includes("mail.acme.test"), true);
    } finally {
      await rm(storageDirectory, { recursive: true, force: true });
    }
  });
});

function listen(server: tls.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function connectWithRoot(port: number, rootCertificate: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port,
      servername: "mail.acme.test",
      ca: rootCertificate,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2"
    });
    socket.once("secureConnect", () => {
      socket.end();
      resolve();
    });
    socket.once("error", reject);
  });
}
