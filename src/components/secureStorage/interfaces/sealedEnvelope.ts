export interface SealedEnvelope {
  sealed: true;
  version?: number;
  nonce: string;
  ciphertext: string;
  authenticationTag?: string;
}
