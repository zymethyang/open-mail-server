import { randomBytes } from "node:crypto";
import path from "node:path";
import { ActivityAction } from "./enums/activityAction.js";
import { ActivityResult } from "./enums/activityResult.js";
import type { ActivityDay, ActivityLogger as ActivityLoggerContract, ActivityQuery } from "./interfaces/activityLogger.js";
import type { ActivityEvent } from "./interfaces/activityEvent.js";
import { withLock } from "../jsonFile/index.js";
import { parseStoredJson } from "../jsonFile/index.js";
import { sealValue } from "../secureStorage/index.js";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function createActivityLogger(storageDirectory: string): ActivityLoggerContract {
  const directory = path.join(storageDirectory, "activity");

  async function readDay(date: string): Promise<ActivityEvent[]> {
    const filePath = path.join(directory, `${date}.jsonl`);
    try {
      const contents = await readFile(filePath, "utf8");
      const events: ActivityEvent[] = [];
      for (const line of contents.split("\n").filter(Boolean)) {
        events.push(await parseStoredJson<ActivityEvent>(line));
      }
      return events;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  return {
    async record(event) {
      const occurredAt = event.occurredAt || new Date().toISOString();
      const stored: ActivityEvent = {
        ...event,
        identifier: randomBytes(12).toString("hex"),
        occurredAt,
        recipientAddresses: event.recipientAddresses || [],
        subject: event.subject || "",
        detail: event.detail || "",
        mailboxAddress: event.mailboxAddress || "",
        senderAddress: event.senderAddress || "",
        remoteAddress: event.remoteAddress || ""
      };
      await withLock("activity", async () => {
        await mkdir(directory, { recursive: true });
        const filePath = path.join(directory, `${dayKey(new Date(occurredAt))}.jsonl`);
        const sealed = await sealValue(stored);
        await appendFile(filePath, `${JSON.stringify(sealed)}\n`, "utf8");
      });
    },

    async query(filters) {
      const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return [] as string[];
        }
        throw error;
      });
      const files = names.filter((name) => name.endsWith(".jsonl")).sort().reverse();
      const events: ActivityEvent[] = [];
      const search = filters.search.trim().toLowerCase();
      for (const fileName of files) {
        const dayEvents = await readDay(fileName.slice(0, 10));
        for (const event of dayEvents.reverse()) {
          if (filters.protocol && event.protocol !== filters.protocol) {
            continue;
          }
          if (filters.result && event.result !== filters.result) {
            continue;
          }
          if (search) {
            const haystack = [
              event.senderAddress,
              event.mailboxAddress,
              event.subject,
              event.detail,
              event.recipientAddresses.join(" ")
            ]
              .join(" ")
              .toLowerCase();
            if (!haystack.includes(search)) {
              continue;
            }
          }
          events.push(event);
          if (events.length >= filters.limit) {
            return events;
          }
        }
      }
      return events;
    },

    async dailyCounts(dayCount) {
      const days: ActivityDay[] = [];
      const today = new Date();
      for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
        const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
        const key = dayKey(date);
        const events = await readDay(key);
        const day: ActivityDay = { date: key, delivered: 0, sent: 0, failed: 0, rejected: 0, incoming: 0, outgoing: 0 };
        for (const event of events) {
          if (event.result === ActivityResult.Delivered && event.action === ActivityAction.Deliver) {
            day.delivered += 1;
            if (event.detail === "sent") {
              day.sent += 1;
              day.outgoing += 1;
            } else {
              day.incoming += 1;
            }
          }
          if (event.result === ActivityResult.Accepted && event.detail === "relayed") {
            day.sent += 1;
            day.outgoing += 1;
          }
          if (event.result === ActivityResult.Failed || event.result === ActivityResult.Queued) {
            day.failed += 1;
          }
          if (event.result === ActivityResult.Rejected) {
            day.rejected += 1;
          }
        }
        days.push(day);
      }
      return days;
    }
  };
}

export class ActivityLogger implements ActivityLoggerContract {
  private readonly logger: ActivityLoggerContract;

  constructor(storageDirectory: string) {
    this.logger = createActivityLogger(storageDirectory);
  }

  record(event: Parameters<ActivityLoggerContract["record"]>[0]) {
    return this.logger.record(event);
  }

  query(filters: ActivityQuery) {
    return this.logger.query(filters);
  }

  dailyCounts(dayCount: number) {
    return this.logger.dailyCounts(dayCount);
  }
}
