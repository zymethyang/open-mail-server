export interface DnsGuideRecord {
  type: string;
  host: string;
  value: string;
}

export interface DnsGuide {
  records: DnsGuideRecord[];
  zoneFile: string;
}

export interface StartupDnsGuide {
  domain: string;
  zoneFile: string;
}
