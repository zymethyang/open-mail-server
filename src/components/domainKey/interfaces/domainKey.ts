export interface DomainKey {
  privateKey: string;
  recordValue: string;
}

export interface HeaderField {
  name: string;
  value: string;
}

export interface StoredDomainKey {
  privateKey?: string;
}
