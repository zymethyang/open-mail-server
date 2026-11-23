import type http from "node:http";
import type { PublicAccount } from "../../account/interfaces/accountRecord.js";
import type { SessionRecord } from "../../session/interfaces/sessionRepository.js";

export interface ServerRequest {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  url: URL;
  account: PublicAccount | null;
  body: Record<string, unknown>;
  session?: SessionRecord | null;
}

export interface PendingSignIn {
  address: string;
  expiresAt: number;
}
