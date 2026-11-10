import { ServiceName } from "./enums/serviceName.js";

export { ServiceName };

export const serviceNames: ServiceName[] = [
  ServiceName.Smtp,
  ServiceName.Imap,
  ServiceName.Pop3,
  ServiceName.Web,
  ServiceName.Queue
];
