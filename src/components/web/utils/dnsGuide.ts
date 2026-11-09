import { domainKeySelector } from "../../domainKey/index.js";

export interface DnsGuideRecord {
  type: string;
  host: string;
  value: string;
}

export interface DnsGuide {
  records: DnsGuideRecord[];
  zoneFile: string;
}

export function createDnsGuide(
  domain: string,
  hostname: string,
  publicAddress: string,
  domainKeyValue = "",
  reportAddress = ""
): DnsGuide {
  const address = publicAddress.trim();
  const reportMailbox = reportAddress.trim() || `admin@${domain}`;
  const addressRecord: DnsGuideRecord = address.includes(":")
    ? { type: "AAAA", host: hostname, value: address }
    : { type: "A", host: hostname, value: address };
  const records = [
    addressRecord,
    { type: "MX", host: domain, value: `10 ${hostname}` },
    { type: "TXT", host: domain, value: senderPolicy(address) },
    ...(domainKeyValue ? [{ type: "TXT", host: `${domainKeySelector}._domainkey.${domain}`, value: domainKeyValue }] : []),
    { type: "TXT", host: `_dmarc.${domain}`, value: `v=DMARC1; p=none; rua=mailto:${reportMailbox}` }
  ];
  return { records, zoneFile: formatZoneFile(records) };
}

function senderPolicy(address: string): string {
  if (!address) {
    return "v=spf1 ~all";
  }
  const mechanism = address.includes(":") ? `ip6:${address}` : `ip4:${address}`;
  return `v=spf1 ${mechanism} ~all`;
}

function absoluteDnsName(host: string): string {
  return host.endsWith(".") ? host : `${host}.`;
}

function formatZoneFile(records: DnsGuideRecord[]): string {
  const lines = records.flatMap((record) => {
    if (!record.value) {
      return [];
    }
    const name = absoluteDnsName(record.host);
    if (record.type === "MX") {
      const [priority, exchange] = record.value.split(/\s+/);
      return [`${name}\t300\tIN\tMX\t${priority} ${absoluteDnsName(exchange || "")}`];
    }
    if (record.type === "TXT") {
      return [`${name}\t300\tIN\tTXT\t${quotedText(record.value)}`];
    }
    return [`${name}\t300\tIN\t${record.type}\t${record.value}`];
  });
  return `${lines.join("\n")}\n`;
}

function quotedText(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const chunks: string[] = [];
  for (let index = 0; index < escaped.length; index += 255) {
    chunks.push(`"${escaped.slice(index, index + 255)}"`);
  }
  return chunks.join(" ");
}
