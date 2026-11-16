export class AcmeChallengeStore {
  private readonly challenges = new Map<string, string>();

  set(token: string, keyAuthorization: string): void {
    this.challenges.set(token, keyAuthorization);
  }

  get(token: string): string | undefined {
    return this.challenges.get(token);
  }

  clear(): void {
    this.challenges.clear();
  }

  remove(token: string): void {
    this.challenges.delete(token);
  }
}

export const sharedAcmeChallengeStore = new AcmeChallengeStore();
