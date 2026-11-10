import type { StartupDnsGuide } from "../../web/interfaces/dnsGuide.js";
import type { ListenerStatus } from "../../web/interfaces/listenerStatus.js";

export interface StartupBanner {
  storageDirectory: string;
  connectionHost: string;
  listeners: ListenerStatus[];
  networkAddresses: string[];
  publishNetworkAddresses: boolean;
  dnsGuide: StartupDnsGuide | null;
}
