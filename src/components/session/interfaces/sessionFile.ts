import type { SessionRecord } from "./sessionRepository.js";

export interface SessionFile {
  sessions?: Record<string, SessionRecord>;
}
