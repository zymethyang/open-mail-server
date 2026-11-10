import { domainKeySignatureMatches } from "../../domainKey/index.js";
import { splitHeaderAndBody } from "../../mime/index.js";
import { lookupIsMissingName } from "../dnsLookup.js";
import { InboundDisposition } from "../enums/inboundDisposition.js";
import type { InboundAuthentication, MailAuthenticationLookup } from "../interfaces/mailAuthenticationLookup.js";
import { evaluateSenderPolicy } from "./senderPolicy.js";

interface SignatureIdentity {
  domain: string;
  selector: string;
  index: number;
}

function headerValue(header: string, name: string): string {
  const lines = header.split(/\r\n|\n/);
  const values: string[] = [];
  let collecting = false;
  for (const line of lines) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (collecting) {
        values[values.length - 1] += line;
      }
      continue;
    }
    const separator = line.indexOf(":");
    collecting = separator > 0 && line.slice(0, separator).trim().toLowerCase() === name;
    if (collecting) {
      values.push(line.slice(separator + 1));
    }
  }
  return values.join("\n");
}

function tag(value: string, name: string): string {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]*)`, "i").exec(value.replace(/\r\n([ \t])/g, " ").replace(/\n([ \t])/g, " "));
  return (match?.[1] || "").trim();
}

function signatureIdentities(header: string): SignatureIdentity[] {
  const identities: SignatureIdentity[] = [];
  const lines = header.split(/\r\n|\n/);
  let current = "";
  let collecting = false;
  const finish = () => {
    if (!collecting) {
      return;
    }
    identities.push({
      domain: tag(current, "d").replace(/\.$/, "").toLowerCase(),
      selector: tag(current, "s").toLowerCase(),
      index: identities.length
    });
    collecting = false;
    current = "";
  };
  for (const line of lines) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (collecting) {
        current += line;
      }
      continue;
    }
    finish();
    const separator = line.indexOf(":");
    collecting = separator > 0 && line.slice(0, separator).trim().toLowerCase() === "dkim-signature";
    if (collecting) {
      current = line.slice(separator + 1);
    }
  }
  finish();
  return identities;
}

function domainsAlign(left: string, right: string): boolean {
  const first = left.trim().toLowerCase().replace(/\.$/, "");
  const second = right.trim().toLowerCase().replace(/\.$/, "");
  if (!first || !second) {
    return false;
  }
  return first === second || first.endsWith(`.${second}`) || second.endsWith(`.${first}`);
}

function domainOfAddress(address: string): string {
  const start = address.lastIndexOf("@");
  return start === -1 ? "" : address.slice(start + 1).trim().toLowerCase();
}

async function textRecords(name: string, lookup: MailAuthenticationLookup): Promise<string[] | "temperror"> {
  try {
    return await lookup.resolveText(name);
  } catch (error) {
    if (lookupIsMissingName(error)) {
      return [];
    }
    return "temperror";
  }
}

async function passingSignatureDomains(message: Buffer, lookup: MailAuthenticationLookup): Promise<string[] | "temperror"> {
  const header = splitHeaderAndBody(message).header.toString("utf8");
  const identities = signatureIdentities(header).filter((identity) => identity.domain && identity.selector);
  const passed: string[] = [];
  for (const identity of identities) {
    const records = await textRecords(`${identity.selector}._domainkey.${identity.domain}`, lookup);
    if (records === "temperror") {
      return "temperror";
    }
    const record = records.find((item) => /(?:^|;)\s*p\s*=/i.test(item)) || "";
    const publicKey = tag(record, "p");
    if (publicKey && domainKeySignatureMatches(message, publicKey, identity.index)) {
      passed.push(identity.domain);
    }
  }
  return passed;
}

async function senderPolicyRecord(fromDomain: string, lookup: MailAuthenticationLookup): Promise<string | "temperror" | "none"> {
  const names = [fromDomain];
  const labels = fromDomain.split(".");
  if (labels.length > 2) {
    names.push(labels.slice(-2).join("."));
  }
  for (const name of names) {
    const records = await textRecords(`_dmarc.${name}`, lookup);
    if (records === "temperror") {
      return "temperror";
    }
    const record = records.find((item) => item.trim().toLowerCase().startsWith("v=dmarc1"));
    if (record) {
      return record;
    }
  }
  return "none";
}

export async function authenticateInboundMessage(
  message: Buffer,
  envelopeAddress: string,
  remoteAddress: string,
  lookup: MailAuthenticationLookup
): Promise<InboundAuthentication> {
  const header = splitHeaderAndBody(message).header.toString("utf8");
  const fromDomain = domainOfAddress(headerValue(header, "from").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || envelopeAddress);
  const envelopeDomain = domainOfAddress(envelopeAddress) || fromDomain;
  const senderPolicy = envelopeDomain ? await evaluateSenderPolicy(envelopeDomain, remoteAddress, lookup) : "none";
  if (senderPolicy === "temperror" || senderPolicy === "permerror") {
    return { disposition: InboundDisposition.Accept, detail: "The sender policy could not be checked" };
  }
  const signatures = await passingSignatureDomains(message, lookup);
  if (signatures === "temperror") {
    return { disposition: InboundDisposition.Accept, detail: "The message signature could not be checked" };
  }
  const policy = fromDomain ? await senderPolicyRecord(fromDomain, lookup) : "none";
  if (policy === "temperror" || policy === "none") {
    return { disposition: InboundDisposition.Accept, detail: "No sender policy requested rejection" };
  }
  const requested = tag(policy, "p").toLowerCase();
  const senderAligned = senderPolicy === "pass" && domainsAlign(envelopeDomain, fromDomain);
  const signatureAligned = signatures.some((domain) => domainsAlign(domain, fromDomain));
  if (senderAligned || signatureAligned || (requested !== "reject" && requested !== "quarantine")) {
    return { disposition: InboundDisposition.Accept, detail: "The sender policy passed" };
  }
  if (requested === "reject") {
    return { disposition: InboundDisposition.Reject, detail: "Rejected by the sender DMARC policy" };
  }
  return { disposition: InboundDisposition.Quarantine, detail: "Quarantined by the sender DMARC policy" };
}
