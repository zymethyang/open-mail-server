import type { Configuration } from "../../configuration/interfaces/configuration.js";
import type { ListenerStatus } from "../../web/interfaces/listenerStatus.js";

export interface RunningEmailServer {
  configuration: Configuration;
  listeners: ListenerStatus[];
  stop(): Promise<void>;
}
