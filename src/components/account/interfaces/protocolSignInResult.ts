import type { ProtocolSignInFailure } from "../enums/protocolSignInFailure.js";
import type { PublicAccount } from "./accountRecord.js";

export interface ProtocolSignInResult {
  account: PublicAccount | null;
  failure: ProtocolSignInFailure;
}
