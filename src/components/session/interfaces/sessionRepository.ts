import type { AccountRole } from "../../account/enums/accountRole.js";

export interface SessionRecord {
  address: string;
  role: AccountRole;
  expiresAt: number;
  csrfToken: string;
}

export interface SessionCreation {
  identifier: string;
  csrfToken: string;
}

export interface SessionRepository {
  create(address: string, role: AccountRole): Promise<SessionCreation>;
  read(identifier: string): Promise<SessionRecord | null>;
  remove(identifier: string): Promise<void>;
  removeForAddress(address: string): Promise<void>;
}
