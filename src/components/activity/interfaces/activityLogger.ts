import type { ActivityEvent } from "./activityEvent.js";

export interface ActivityQuery {
  protocol: string;
  result: string;
  search: string;
  limit: number;
}

export interface ActivityDay {
  date: string;
  delivered: number;
  sent: number;
  failed: number;
  rejected: number;
  incoming: number;
  outgoing: number;
}

export interface ActivityLogger {
  record(event: Omit<ActivityEvent, "identifier" | "occurredAt"> & { occurredAt?: string }): Promise<void>;
  query(filters: ActivityQuery): Promise<ActivityEvent[]>;
  dailyCounts(dayCount: number): Promise<ActivityDay[]>;
  attentionEvents(): Promise<ActivityEvent[]>;
  acknowledgeAttention(): Promise<string>;
}
