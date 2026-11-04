import type { PortReachabilityResult } from "../enums/portReachabilityResult.js";

export interface PortReachability {
  port: number;
  result: PortReachabilityResult;
  detail: string;
}

export interface PublicReachability {
  address: string;
  source: string;
  checks: PortReachability[];
}
