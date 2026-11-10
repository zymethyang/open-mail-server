import type { ProtocolSignInResult } from "../interfaces/protocolSignInResult.js";
import { ProtocolSignInFailure } from "../enums/protocolSignInFailure.js";
import type { AccountRepository } from "../interfaces/accountRepository.js";

type CredentialCheck = Pick<AccountRepository, "verifyCredentials">;

export async function verifyProtocolSignIn(accounts: CredentialCheck, username: string, secret: string): Promise<ProtocolSignInResult> {
  const account = await accounts.verifyCredentials(username, secret);
  if (!account) {
    return { account: null, failure: ProtocolSignInFailure.Invalid };
  }
  return { account, failure: ProtocolSignInFailure.None };
}
