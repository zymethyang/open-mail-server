import type { AccountRole } from "../enums/accountRole.js";

export interface PublicAccount {
  address: string;
  displayName: string;
  role: AccountRole;
  createdAt: string;
  disabled: boolean;
  oneTimePasswordEnabled: boolean;
}

export interface AccountRecord extends PublicAccount {
  passwordSalt: string;
  passwordHash: string;
  oneTimePasswordSecret?: string;
  oneTimePasswordPendingSecret?: string;
}
