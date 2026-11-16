import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CertificateDescription } from "../interfaces/certificateDescription.js";
import type { AcmeChallengeStore } from "./acmeChallengeStore.js";
import { AcmeClient, type AcmeClientDependencies, type AcmeIssuedCertificate } from "./acmeClient.js";
import { assertAcmeContactEmail, assertAcmeHostname } from "./acmeHostname.js";
import {
  isAcmeManagedCertificate,
  markAcmeManagedCertificate,
  readAcmeAccountKey,
  readAcmeAccountUrl,
  storeAcmeAccountKey,
  storeAcmeAccountUrl
} from "./acmeProvenance.js";
import { certificateRenewal } from "./renewal.js";
import { describeCertificateMaterial, storeCertificateMaterial } from "./storedCertificate.js";

export type AcmeIssuer = (input: {
  hostname: string;
  contactEmail: string;
  challengeStore: AcmeChallengeStore;
  accountKeyPem?: string;
  accountUrl?: string;
}) => Promise<AcmeIssuedCertificate>;

export interface AcmeServiceDependencies {
  storageDirectory: string;
  challengeStore: AcmeChallengeStore;
  resolveHostname: () => Promise<string>;
  resolveContactEmail: () => Promise<string>;
  activateCertificate: (certificatePem: string, privateKeyPem: string) => Promise<void> | void;
  issuer?: AcmeIssuer;
  clientDependencies?: AcmeClientDependencies;
}

function defaultIssuer(clientDependencies: AcmeClientDependencies = {}): AcmeIssuer {
  return async (input) => {
    const client = new AcmeClient({
      ...clientDependencies,
      accountKeyPem: input.accountKeyPem || clientDependencies.accountKeyPem,
      accountUrl: input.accountUrl || clientDependencies.accountUrl
    });
    return client.issueCertificate(input.hostname, input.contactEmail, input.challengeStore);
  };
}

export class AcmeCertificateService {
  private readonly storageDirectory: string;
  private readonly challengeStore: AcmeChallengeStore;
  private readonly resolveHostname: () => Promise<string>;
  private readonly resolveContactEmail: () => Promise<string>;
  private readonly activateCertificate: (certificatePem: string, privateKeyPem: string) => Promise<void> | void;
  private readonly issuer: AcmeIssuer;
  private operationChain: Promise<unknown> = Promise.resolve();

  constructor(dependencies: AcmeServiceDependencies) {
    this.storageDirectory = dependencies.storageDirectory;
    this.challengeStore = dependencies.challengeStore;
    this.resolveHostname = dependencies.resolveHostname;
    this.resolveContactEmail = dependencies.resolveContactEmail;
    this.activateCertificate = dependencies.activateCertificate;
    this.issuer = dependencies.issuer || defaultIssuer(dependencies.clientDependencies);
  }

  private runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationChain.then(operation, operation);
    this.operationChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async issue(): Promise<CertificateDescription> {
    return this.runSerialized(() => this.performIssue());
  }

  async renew(): Promise<CertificateDescription> {
    return this.runSerialized(() => this.performRenew());
  }

  async renewIfDue(now = Date.now()): Promise<CertificateDescription | undefined> {
    if (!(await isAcmeManagedCertificate(this.storageDirectory))) {
      return undefined;
    }
    const description = await this.readDescription();
    if (!certificateRenewal(description.validUntil, now).renewalRequired) {
      return undefined;
    }
    return this.renew();
  }

  private async performIssue(): Promise<CertificateDescription> {
    const hostname = assertAcmeHostname(await this.resolveHostname());
    const contactEmail = assertAcmeContactEmail(await this.resolveContactEmail());
    try {
      const accountKeyPem = await readAcmeAccountKey(this.storageDirectory);
      const accountUrl = await readAcmeAccountUrl(this.storageDirectory);
      const issued = await this.issuer({
        hostname,
        contactEmail,
        challengeStore: this.challengeStore,
        accountKeyPem,
        accountUrl
      });
      return this.storeIssued(issued);
    } finally {
      this.challengeStore.clear();
    }
  }

  private async performRenew(): Promise<CertificateDescription> {
    if (!(await isAcmeManagedCertificate(this.storageDirectory))) {
      throw Object.assign(new Error("Only a Let’s Encrypt certificate from this server can be renewed here"), { statusCode: 400 });
    }
    return this.performIssue();
  }

  private async storeIssued(issued: AcmeIssuedCertificate): Promise<CertificateDescription> {
    await storeAcmeAccountKey(this.storageDirectory, issued.accountKeyPem);
    await storeAcmeAccountUrl(this.storageDirectory, issued.accountUrl);
    await markAcmeManagedCertificate(this.storageDirectory);
    const description = await storeCertificateMaterial(this.storageDirectory, issued.certificatePem, issued.privateKeyPem, "", {
      acmeManaged: true
    });
    await this.activateCertificate(issued.certificatePem, issued.privateKeyPem);
    return description;
  }

  private async readDescription(): Promise<CertificateDescription> {
    const directory = path.join(this.storageDirectory, "certificates");
    const [certificate, privateKey] = await Promise.all([
      readFile(path.join(directory, "certificate.pem"), "utf8"),
      readFile(path.join(directory, "private-key.pem"), "utf8")
    ]);
    return {
      ...describeCertificateMaterial(certificate, privateKey),
      acmeManaged: true
    };
  }
}
