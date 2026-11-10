import type http from "node:http";
import type { PublicAccount } from "../../account/interfaces/accountRecord.js";

export interface ServerRequest {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  url: URL;
  account: PublicAccount | null;
  body: Record<string, unknown>;
}

export interface PendingSignIn {
  address: string;
  expiresAt: number;
}
