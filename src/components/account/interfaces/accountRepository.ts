import type { AccountRole } from "../enums/accountRole.js";
import type { PublicAccount } from "./accountRecord.js";

export interface AccountRepository {
  listAccounts(): Promise<PublicAccount[]>;
  hasAccounts(): Promise<boolean>;
  findAccount(address: string): Promise<PublicAccount | null>;
  exists(address: string): Promise<boolean>;
  verifyCredentials(address: string, password: string): Promise<PublicAccount | null>;
  createAccount(input: {
    address: string;
    displayName: string;
    password: string;
    role: AccountRole;
    domain: string;
  }): Promise<PublicAccount>;
  replacePassword(address: string, password: string): Promise<PublicAccount>;
  setDisabled(address: string, disabled: boolean): Promise<PublicAccount>;
  storePendingOneTimePassword(address: string, secret: string): Promise<void>;
  confirmOneTimePassword(address: string, code: string): Promise<PublicAccount | null>;
  oneTimePasswordMatches(address: string, code: string): Promise<boolean>;
  clearOneTimePassword(address: string): Promise<PublicAccount>;
}
