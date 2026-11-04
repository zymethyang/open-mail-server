export interface SealedEnvelope {
  sealed: true;
  nonce: string;
  ciphertext: string;
}
