export interface AddressAlias {
  address: string;
  mailboxAddress: string;
}

export interface AddressList {
  address: string;
  mailboxAddresses: string[];
}

export interface CatchAllMailbox {
  domain: string;
  mailboxAddress: string;
}

export interface AddressRoutes {
  domains: string[];
  aliases: AddressAlias[];
  lists: AddressList[];
  catchAllMailboxes: CatchAllMailbox[];
  blockedSenders: string[];
  blockedDomains: string[];
  blockedRemoteAddresses: string[];
}
