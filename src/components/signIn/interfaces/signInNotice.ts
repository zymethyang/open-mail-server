export interface SignInFailureRecord {
  count: number;
  startedAt: number;
  blockedUntil: number;
}

export interface SignInNotice {
  kind: "sign-in";
  key: string;
  record: SignInFailureRecord | null;
}
