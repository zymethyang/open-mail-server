import type { SessionAccount } from "./models.js";

export interface SessionResponse {
  oneTimePasswordRequired?: boolean;
}

export interface AccountResponse {
  account: SessionAccount;
}

export interface AuthenticatorSetup {
  image: string;
  secret: string;
}
