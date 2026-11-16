import crypto from "node:crypto";
import type { AcmeChallengeStore } from "./acmeChallengeStore.js";
import { createCertificateSigningRequestBase64Url } from "./acmeCertificateSigningRequest.js";
import { createAcmeAccountKey, jsonWebKeyThumbprint, loadAcmeAccountKey, signAcmeJsonWebSignature } from "./acmeJose.js";

export const letsEncryptDirectoryUrl = "https://acme-v02.api.letsencrypt.org/directory";

export interface AcmeDirectory {
  newNonce: string;
  newAccount: string;
  newOrder: string;
}

export interface AcmeIssuedCertificate {
  certificatePem: string;
  privateKeyPem: string;
  accountKeyPem: string;
  accountUrl: string;
}

export interface AcmeClientDependencies {
  directoryUrl?: string;
  fetchImplementation?: typeof fetch;
  accountKeyPem?: string;
  accountUrl?: string;
  pollIntervalMilliseconds?: number;
  pollAttempts?: number;
}

interface AcmeAuthorization {
  status: string;
  challenges: Array<{ type: string; url: string; token: string; status: string }>;
}

interface AcmeOrder {
  status: string;
  authorizations: string[];
  finalize: string;
  certificate?: string;
}

function operatorSafeMessage(error: unknown): string {
  if (error instanceof Error && "statusCode" in error) {
    return error.message;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/rate.?limit/i.test(message)) {
    return "Let’s Encrypt rate-limited this request. Try again later.";
  }
  if (/timeout|ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(message)) {
    return "Could not reach Let’s Encrypt. Check outbound HTTPS and try again.";
  }
  return "Let’s Encrypt could not issue the certificate. Check DNS and that port 80 is reachable from the internet.";
}

function rejected(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode });
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class AcmeClient {
  private readonly directoryUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly pollIntervalMilliseconds: number;
  private readonly pollAttempts: number;
  private directory: AcmeDirectory | undefined;
  private nonce: string | undefined;
  private accountKeyPem: string;
  private accountPrivateKey: crypto.KeyObject;
  private accountJsonWebKey: ReturnType<typeof createAcmeAccountKey>["jsonWebKey"];
  private accountUrl: string | undefined;

  constructor(dependencies: AcmeClientDependencies = {}) {
    this.directoryUrl = dependencies.directoryUrl || letsEncryptDirectoryUrl;
    this.fetchImplementation = dependencies.fetchImplementation || fetch;
    this.pollIntervalMilliseconds = dependencies.pollIntervalMilliseconds ?? 2000;
    this.pollAttempts = dependencies.pollAttempts ?? 30;
    if (dependencies.accountKeyPem) {
      const loaded = loadAcmeAccountKey(dependencies.accountKeyPem);
      this.accountKeyPem = dependencies.accountKeyPem;
      this.accountPrivateKey = loaded.privateKey;
      this.accountJsonWebKey = loaded.jsonWebKey;
    } else {
      const created = createAcmeAccountKey();
      this.accountKeyPem = created.privateKeyPem;
      this.accountPrivateKey = created.privateKey;
      this.accountJsonWebKey = created.jsonWebKey;
    }
    this.accountUrl = dependencies.accountUrl;
  }

  accountMaterial(): { accountKeyPem: string; accountUrl: string | undefined } {
    return { accountKeyPem: this.accountKeyPem, accountUrl: this.accountUrl };
  }

  async issueCertificate(hostname: string, contactEmail: string, challengeStore: AcmeChallengeStore): Promise<AcmeIssuedCertificate> {
    try {
      await this.ensureDirectory();
      await this.ensureAccount(contactEmail);
      const orderUrl = await this.createOrder(hostname);
      let order = await this.readOrder(orderUrl);
      for (const authorizationUrl of order.authorizations) {
        await this.completeHttpChallenge(authorizationUrl, challengeStore);
      }
      order = await this.waitForOrder(orderUrl, ["ready", "valid"]);
      const certificateKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      const privateKeyPem = certificateKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const certificateSigningRequest = createCertificateSigningRequestBase64Url(hostname, certificateKeys.privateKey);
      await this.signedRequest(order.finalize, { csr: certificateSigningRequest });
      order = await this.waitForOrder(orderUrl, ["valid"]);
      if (!order.certificate) {
        throw rejected("Let’s Encrypt did not return a certificate URL");
      }
      const certificateResponse = await this.signedRequest(order.certificate, "");
      const certificatePem = await certificateResponse.text();
      if (!certificatePem.includes("BEGIN CERTIFICATE")) {
        throw rejected("Let’s Encrypt returned an empty certificate");
      }
      if (!this.accountUrl) {
        throw rejected("The Let’s Encrypt account URL is missing");
      }
      return {
        certificatePem: certificatePem.endsWith("\n") ? certificatePem : `${certificatePem}\n`,
        privateKeyPem,
        accountKeyPem: this.accountKeyPem,
        accountUrl: this.accountUrl
      };
    } catch (error) {
      throw rejected(operatorSafeMessage(error), (error as { statusCode?: number }).statusCode || 400);
    } finally {
      challengeStore.clear();
    }
  }

  private async ensureDirectory(): Promise<void> {
    if (this.directory) {
      return;
    }
    const response = await this.fetchImplementation(this.directoryUrl);
    if (!response.ok) {
      throw rejected("Could not load the Let’s Encrypt directory");
    }
    const body = (await response.json()) as Partial<AcmeDirectory>;
    if (!body.newNonce || !body.newAccount || !body.newOrder) {
      throw rejected("The Let’s Encrypt directory is incomplete");
    }
    this.directory = { newNonce: body.newNonce, newAccount: body.newAccount, newOrder: body.newOrder };
  }

  private async ensureNonce(): Promise<string> {
    if (this.nonce) {
      const current = this.nonce;
      this.nonce = undefined;
      return current;
    }
    await this.ensureDirectory();
    const response = await this.fetchImplementation(this.directory!.newNonce, { method: "HEAD" });
    const nonce = response.headers.get("replay-nonce");
    if (!nonce) {
      throw rejected("Let’s Encrypt did not return a nonce");
    }
    return nonce;
  }

  private rememberNonce(response: Response): void {
    const nonce = response.headers.get("replay-nonce");
    if (nonce) {
      this.nonce = nonce;
    }
  }

  private async signedRequest(url: string, payload: Record<string, unknown> | string, useKey = false): Promise<Response> {
    await this.ensureDirectory();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const nonce = await this.ensureNonce();
      const protectedHeader: Record<string, unknown> = {
        alg: "ES256",
        nonce,
        url
      };
      if (useKey || !this.accountUrl) {
        protectedHeader.jwk = this.accountJsonWebKey;
      } else {
        protectedHeader.kid = this.accountUrl;
      }
      const body = signAcmeJsonWebSignature(this.accountPrivateKey, protectedHeader, payload);
      const response = await this.fetchImplementation(url, {
        method: "POST",
        headers: { "Content-Type": "application/jose+json" },
        body
      });
      this.rememberNonce(response);
      if (response.status === 400) {
        const problem = (await response.clone().json().catch(() => ({}))) as { type?: string };
        if (typeof problem.type === "string" && problem.type.includes("badNonce")) {
          this.nonce = undefined;
          continue;
        }
      }
      if (!response.ok && response.status !== 201 && response.status !== 200) {
        const problem = (await response.json().catch(() => ({}))) as { detail?: string };
        throw rejected(problem.detail || `Let’s Encrypt request failed (${response.status})`);
      }
      return response;
    }
    throw rejected("Let’s Encrypt rejected the request nonce");
  }

  private async ensureAccount(contactEmail: string): Promise<void> {
    if (this.accountUrl) {
      return;
    }
    const response = await this.signedRequest(
      this.directory!.newAccount,
      {
        termsOfServiceAgreed: true,
        contact: [`mailto:${contactEmail}`]
      },
      true
    );
    const location = response.headers.get("location");
    if (!location) {
      throw rejected("Let’s Encrypt did not return an account URL");
    }
    this.accountUrl = location;
  }

  private async createOrder(hostname: string): Promise<string> {
    const response = await this.signedRequest(this.directory!.newOrder, {
      identifiers: [{ type: "dns", value: hostname }]
    });
    const location = response.headers.get("location");
    if (!location) {
      throw rejected("Let’s Encrypt did not return an order URL");
    }
    return location;
  }

  private async readOrder(orderUrl: string): Promise<AcmeOrder> {
    const response = await this.signedRequest(orderUrl, "");
    return (await response.json()) as AcmeOrder;
  }

  private async waitForOrder(orderUrl: string, accepted: string[]): Promise<AcmeOrder> {
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      const order = await this.readOrder(orderUrl);
      if (accepted.includes(order.status)) {
        return order;
      }
      if (order.status === "invalid") {
        throw rejected("Let’s Encrypt marked the order invalid. Check DNS and port 80.");
      }
      await delay(this.pollIntervalMilliseconds);
    }
    throw rejected("Let’s Encrypt did not finish the order in time");
  }

  private async completeHttpChallenge(authorizationUrl: string, challengeStore: AcmeChallengeStore): Promise<void> {
    const authorizationResponse = await this.signedRequest(authorizationUrl, "");
    const authorization = (await authorizationResponse.json()) as AcmeAuthorization;
    if (authorization.status === "valid") {
      return;
    }
    const challenge = authorization.challenges.find((item) => item.type === "http-01");
    if (!challenge) {
      throw rejected("Let’s Encrypt did not offer an HTTP-01 challenge");
    }
    const keyAuthorization = `${challenge.token}.${jsonWebKeyThumbprint(this.accountJsonWebKey)}`;
    challengeStore.set(challenge.token, keyAuthorization);
    await this.signedRequest(challenge.url, {});
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      const latestResponse = await this.signedRequest(authorizationUrl, "");
      const latest = (await latestResponse.json()) as AcmeAuthorization;
      if (latest.status === "valid") {
        challengeStore.remove(challenge.token);
        return;
      }
      if (latest.status === "invalid") {
        throw rejected("Let’s Encrypt could not validate HTTP-01 on port 80");
      }
      await delay(this.pollIntervalMilliseconds);
    }
    throw rejected("Let’s Encrypt did not validate HTTP-01 in time");
  }
}
