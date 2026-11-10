import type { Configuration } from "../../configuration/interfaces/configuration.js";
import type { ListenerStatus } from "../../web/interfaces/listenerStatus.js";
import type { ServiceName } from "../enums/serviceName.js";
import type { WorkerMessageKind } from "../enums/workerMessageKind.js";

export interface WorkerInput {
  service: ServiceName;
  configuration: Configuration;
}

export interface WorkerMessage {
  kind?: WorkerMessageKind;
  service?: ServiceName;
  listeners?: ListenerStatus[];
  detail?: string;
  requestId?: number;
  domain?: string;
  records?: unknown;
  error?: string;
}

export interface ParentResponse {
  kind: WorkerMessageKind.ParentResponse;
  requestId: number;
  records?: unknown;
  error?: string;
}
