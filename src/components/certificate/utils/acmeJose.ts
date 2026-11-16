import crypto from "node:crypto";

export function encodeBase64Url(value: Buffer | string): string {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

interface EcJsonWebKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export function createAcmeAccountKey(): { privateKey: crypto.KeyObject; privateKeyPem: string; jsonWebKey: EcJsonWebKey } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const details = publicKey.export({ format: "jwk" }) as { x?: string; y?: string };
  if (!details.x || !details.y) {
    throw new Error("The ACME account key could not be created");
  }
  return {
    privateKey,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    jsonWebKey: { kty: "EC", crv: "P-256", x: details.x, y: details.y }
  };
}

export function loadAcmeAccountKey(privateKeyPem: string): { privateKey: crypto.KeyObject; jsonWebKey: EcJsonWebKey } {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(privateKey);
  const details = publicKey.export({ format: "jwk" }) as { x?: string; y?: string; kty?: string; crv?: string };
  if (details.kty !== "EC" || details.crv !== "P-256" || !details.x || !details.y) {
    throw new Error("The ACME account key is not a P-256 key");
  }
  return {
    privateKey,
    jsonWebKey: { kty: "EC", crv: "P-256", x: details.x, y: details.y }
  };
}

export function jsonWebKeyThumbprint(jsonWebKey: EcJsonWebKey): string {
  const canonical = JSON.stringify({ crv: jsonWebKey.crv, kty: jsonWebKey.kty, x: jsonWebKey.x, y: jsonWebKey.y });
  return encodeBase64Url(crypto.createHash("sha256").update(canonical).digest());
}

export function signAcmeJsonWebSignature(
  privateKey: crypto.KeyObject,
  protectedHeader: Record<string, unknown>,
  payload: Record<string, unknown> | string
): string {
  const protectedPart = encodeBase64Url(JSON.stringify(protectedHeader));
  const payloadPart = encodeBase64Url(typeof payload === "string" ? payload : JSON.stringify(payload));
  const signingInput = `${protectedPart}.${payloadPart}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput, "ascii"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363"
  });
  return JSON.stringify({
    protected: protectedPart,
    payload: payloadPart,
    signature: encodeBase64Url(signature)
  });
}
