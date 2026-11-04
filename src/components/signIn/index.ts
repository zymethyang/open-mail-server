import { signInAttemptLimit, signInBlockMilliseconds, signInWindowMilliseconds } from "./constants/signInLimits.js";
import type { SignInGuard as SignInGuardContract } from "./interfaces/signInGuard.js";

interface FailureRecord {
  count: number;
  startedAt: number;
  blockedUntil: number;
}

export class SignInGuard implements SignInGuardContract {
  private readonly failures = new Map<string, FailureRecord>();

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
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }
}
