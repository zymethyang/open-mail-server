import type { ActivityAction } from "../enums/activityAction.js";
import type { ActivityResult } from "../enums/activityResult.js";
import type { MailProtocol } from "../../protocol/enums/mailProtocol.js";

export interface ActivityEvent {
  identifier: string;
  occurredAt: string;
  protocol: MailProtocol;
  action: ActivityAction;
  remoteAddress: string;
  mailboxAddress: string;
  senderAddress: string;
  recipientAddresses: string[];
  subject: string;
  byteCount: number;
  result: ActivityResult;
  detail: string;
}
