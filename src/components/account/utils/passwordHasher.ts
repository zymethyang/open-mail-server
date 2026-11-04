import crypto from "node:crypto";

const dummySalt = crypto.randomBytes(16).toString("hex");
const dummyHash = crypto.scryptSync("placeholder-password", dummySalt, 32).toString("hex");

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return { salt, hash };
}

export function passwordsMatch(password: string, salt?: string, hash?: string): boolean {
  const actualSalt = salt || dummySalt;
  const actualHash = hash || dummyHash;
  const candidate = crypto.scryptSync(String(password), actualSalt, 32);
  const expected = Buffer.from(actualHash, "hex");
  if (expected.length !== candidate.length) {
    return false;
  }
  return Boolean(salt && hash) && crypto.timingSafeEqual(candidate, expected);
}
