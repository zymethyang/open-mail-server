import { domainOf, normalizeAddress } from "../../text/index.js";
import type { AddressRoutes } from "../interfaces/addressRoutes.js";

export type RecipientResolution =
  | { kind: "mailboxes"; mailboxAddresses: string[] }
  | { kind: "missing" }
  | { kind: "external" };

export async function resolveDeliveryAddress(
  address: string,
  companyDomain: string,
  routes: AddressRoutes,
  mailboxExists: (mailboxAddress: string) => Promise<boolean>
): Promise<RecipientResolution> {
  const normalized = normalizeAddress(address);
  const domain = domainOf(normalized);
  const accepted = domain === companyDomain || routes.domains.includes(domain);
  if (!accepted) {
    return { kind: "external" };
  }
  if (await mailboxExists(normalized)) {
    return { kind: "mailboxes", mailboxAddresses: [normalized] };
  }
  const alias = routes.aliases.find((item) => item.address === normalized);
  if (alias) {
    return (await mailboxExists(alias.mailboxAddress))
      ? { kind: "mailboxes", mailboxAddresses: [alias.mailboxAddress] }
      : { kind: "missing" };
  }
  const list = routes.lists.find((item) => item.address === normalized);
  if (list) {
    const mailboxAddresses: string[] = [];
    for (const mailboxAddress of list.mailboxAddresses) {
      if (await mailboxExists(mailboxAddress) && !mailboxAddresses.includes(mailboxAddress)) {
        mailboxAddresses.push(mailboxAddress);
      }
    }
    return mailboxAddresses.length ? { kind: "mailboxes", mailboxAddresses } : { kind: "missing" };
  }
  const catchAll = routes.catchAllMailboxes.find((item) => item.domain === domain);
  if (catchAll && (await mailboxExists(catchAll.mailboxAddress))) {
    return { kind: "mailboxes", mailboxAddresses: [catchAll.mailboxAddress] };
  }
  return { kind: "missing" };
}

export function blockedSenderDetail(routes: AddressRoutes, senderAddress: string, remoteAddress: string): string {
  const sender = normalizeAddress(senderAddress);
  const domain = domainOf(sender);
  const remote = remoteAddress.trim().toLowerCase().replace(/^::ffff:/, "");
  if (sender && routes.blockedSenders.includes(sender)) {
    return "The sender is blocked";
  }
  if (domain && routes.blockedDomains.includes(domain)) {
    return "The sender domain is blocked";
  }
  if (remote && routes.blockedRemoteAddresses.includes(remote)) {
    return "The sending address is blocked";
  }
  return "";
}
