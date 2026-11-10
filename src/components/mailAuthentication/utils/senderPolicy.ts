import { BlockList } from "node:net";
import { lookupIsMissingName } from "../dnsLookup.js";
import type { MailAuthenticationLookup } from "../interfaces/mailAuthenticationLookup.js";

export type SenderPolicyResult = "pass" | "fail" | "softfail" | "neutral" | "none" | "temperror" | "permerror";

const maximumPolicyDepth = 10;

function normalizedAddress(address: string): string {
  const value = address.trim().toLowerCase();
  return value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
}

function addressIsInternetProtocolVersion6(address: string): boolean {
  return address.includes(":");
}

function addressMatches(remoteAddress: string, network: string): boolean {
  const [address, prefixText] = network.split("/");
  const family = addressIsInternetProtocolVersion6(address) ? "ipv6" : "ipv4";
  if (addressIsInternetProtocolVersion6(remoteAddress) !== (family === "ipv6")) {
    return false;
  }
  const prefix = prefixText ? Number(prefixText) : family === "ipv6" ? 128 : 32;
  if (!Number.isInteger(prefix)) {
    return false;
  }
  const list = new BlockList();
  try {
    if (prefixText) {
      list.addSubnet(address, prefix, family);
    } else {
      list.addAddress(address, family);
    }
    return list.check(remoteAddress, family);
  } catch {
    return false;
  }
}

function qualifierResult(qualifier: string): SenderPolicyResult {
  if (qualifier === "-") {
    return "fail";
  }
  if (qualifier === "~") {
    return "softfail";
  }
  if (qualifier === "?") {
    return "neutral";
  }
  return "pass";
}

async function addressesFor(name: string, lookup: MailAuthenticationLookup): Promise<string[] | "temperror"> {
  try {
    return (await lookup.resolveAddresses(name)).map((address) => normalizedAddress(address));
  } catch (error) {
    if (lookupIsMissingName(error)) {
      return [];
    }
    return "temperror";
  }
}

export async function evaluateSenderPolicy(
  domain: string,
  remoteAddress: string,
  lookup: MailAuthenticationLookup,
  depth = 0,
  seen: Set<string> = new Set()
): Promise<SenderPolicyResult> {
  const name = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!name || depth > maximumPolicyDepth || seen.has(name)) {
    return "permerror";
  }
  seen.add(name);
  let records: string[];
  try {
    records = await lookup.resolveText(name);
  } catch (error) {
    if (lookupIsMissingName(error)) {
      return "none";
    }
    return "temperror";
  }
  const policy = records.find((record) => record.trim().toLowerCase().startsWith("v=spf1"));
  if (!policy) {
    return "none";
  }
  const address = normalizedAddress(remoteAddress);
  let redirect = "";
  for (const term of policy.trim().split(/\s+/).slice(1)) {
    if (!term || term.toLowerCase().startsWith("exp=")) {
      continue;
    }
    const qualifier = "+-~?".includes(term[0]) ? term[0] : "+";
    const body = qualifier === "+" && !term.startsWith("+") ? term : term.slice(1);
    const colon = body.indexOf(":");
    const equals = body.indexOf("=");
    const separator = colon === -1 ? equals : equals === -1 ? colon : Math.min(colon, equals);
    const mechanism = (separator === -1 ? body : body.slice(0, separator)).toLowerCase();
    const argument = separator === -1 ? "" : body.slice(separator + 1);
    if (mechanism === "redirect") {
      redirect = argument;
      continue;
    }
    const matched = await mechanismMatches(mechanism, argument, name, address, lookup, depth, seen);
    if (matched === "temperror" || matched === "permerror") {
      return matched;
    }
    if (matched === true) {
      return qualifierResult(qualifier);
    }
  }
  if (redirect) {
    return evaluateSenderPolicy(redirect, address, lookup, depth + 1, seen);
  }
  return "neutral";
}

async function mechanismMatches(
  mechanism: string,
  argument: string,
  domain: string,
  remoteAddress: string,
  lookup: MailAuthenticationLookup,
  depth: number,
  seen: Set<string>
): Promise<boolean | "temperror" | "permerror"> {
  if (mechanism === "all") {
    return true;
  }
  if (mechanism === "ip4" || mechanism === "ip6") {
    return addressMatches(remoteAddress, argument);
  }
  if (mechanism === "a") {
    const addresses = await addressesFor(argument || domain, lookup);
    if (addresses === "temperror") {
      return "temperror";
    }
    return addresses.includes(remoteAddress);
  }
  if (mechanism === "mx") {
    try {
      const exchanges = await lookup.resolveMailExchanges(argument || domain);
      for (const exchange of exchanges) {
        const addresses = await addressesFor(exchange, lookup);
        if (addresses === "temperror") {
          return "temperror";
        }
        if (addresses.includes(remoteAddress)) {
          return true;
        }
      }
      return false;
    } catch (error) {
      if (lookupIsMissingName(error)) {
        return false;
      }
      return "temperror";
    }
  }
  if (mechanism === "include") {
    if (!argument) {
      return "permerror";
    }
    const included = await evaluateSenderPolicy(argument, remoteAddress, lookup, depth + 1, seen);
    if (included === "pass") {
      return true;
    }
    if (included === "temperror" || included === "permerror") {
      return included;
    }
    return false;
  }
  return false;
}
