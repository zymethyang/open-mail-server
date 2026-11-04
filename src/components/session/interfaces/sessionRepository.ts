import type { AccountRole } from "../../account/enums/accountRole.js";

export interface SessionRecord {
  address: string;
  role: AccountRole;
  expiresAt: number;
}

export interface SessionRepository {
  create(address: string, role: AccountRole): Promise<string>;
  read(identifier: string): Promise<SessionRecord | null>;
  remove(identifier: string): Promise<void>;
  removeForAddress(address: string): Promise<void>;
}
