export interface SignInGuard {
  rejectionMessage(key: string): string;
  recordFailure(key: string): void;
  recordSuccess(key: string): void;
}
