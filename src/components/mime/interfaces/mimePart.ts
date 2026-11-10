export interface HeaderMap {
  [name: string]: string;
}

export interface AddressPiece {
  name: string;
  address: string;
}

export interface MimePart {
  headers: HeaderMap;
  body: Buffer;
  children: MimePart[];
}
