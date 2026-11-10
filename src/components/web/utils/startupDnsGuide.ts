import type { Configuration } from "../../configuration/interfaces/configuration.js";
import { openDomainKey } from "../../domainKey/index.js";
import { OrganizationRepository } from "../../organization/index.js";
import { openSecureStorage } from "../../secureStorage/index.js";
import { SettingsRepository } from "../../settings/index.js";
import type { StartupDnsGuide } from "../interfaces/dnsGuide.js";
import { createDnsGuide } from "./dnsGuide.js";

export function mailHostname(publicHostname: string, configuredHostname: string, domain: string, configuredDomain: string): string {
  return publicHostname.trim() || configuredHostname.trim() || domain || configuredDomain || "localhost";
}

export async function readStoredDnsGuide(configuration: Configuration): Promise<StartupDnsGuide | null> {
  await openSecureStorage(configuration.storageDirectory);
  const organization = await new OrganizationRepository(configuration.storageDirectory).read();
  if (!organization) {
    return null;
  }
  const settings = await new SettingsRepository(configuration.storageDirectory).read();
  const hostname = mailHostname(settings.publicHostname, configuration.publicHostname, organization.domain, configuration.configuredDomain);
  const domainKey = await openDomainKey(configuration.storageDirectory);
  const guide = createDnsGuide(organization.domain, hostname, organization.publicAddress, domainKey.recordValue, organization.administratorAddress);
  return { domain: organization.domain, zoneFile: guide.zoneFile };
}
