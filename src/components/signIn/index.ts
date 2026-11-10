import { signInAttemptLimit, signInBlockMilliseconds, signInWindowMilliseconds } from "./constants/signInLimits.js";
import type { SignInGuard as SignInGuardContract } from "./interfaces/signInGuard.js";
import type { SignInFailureRecord, SignInNotice } from "./interfaces/signInNotice.js";

export class SignInGuard implements SignInGuardContract {
  private readonly failures = new Map<string, SignInFailureRecord>();
  private readonly channel = new BroadcastChannel("email-server-sign-in");

  constructor() {
    (this.channel as BroadcastChannel & { unref(): void }).unref();
    this.channel.addEventListener("message", (event: MessageEvent<SignInNotice>) => {
      const notice = event.data;
      if (!notice || notice.kind !== "sign-in" || typeof notice.key !== "string") {
        return;
      }
      if (!notice.record) {
        this.failures.delete(notice.key);
        return;
      }
      const current = this.failures.get(notice.key);
      if (!current || notice.record.count >= current.count || notice.record.blockedUntil >= current.blockedUntil) {
        this.failures.set(notice.key, notice.record);
      }
    });
  }

  rejectionMessage(key: string): string {
    const record = this.failures.get(key);
    if (!record || !record.blockedUntil) {
      return "";
    }
    if (record.blockedUntil <= Date.now()) {
      this.failures.delete(key);
      return "";
    }
    return "Too many sign-in attempts. Try again later.";
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const record = this.failures.get(key) || { count: 0, startedAt: now, blockedUntil: 0 };
    if (now - record.startedAt > signInWindowMilliseconds) {
      record.count = 0;
      record.startedAt = now;
      record.blockedUntil = 0;
    }
    record.count += 1;
    if (record.count >= signInAttemptLimit) {
      record.blockedUntil = now + signInBlockMilliseconds;
    }
    this.failures.set(key, record);
    this.channel.postMessage({ kind: "sign-in", key, record: { ...record } });
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
    this.channel.postMessage({ kind: "sign-in", key, record: null });
  }
}
