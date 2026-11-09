import type { OrganizationRecord } from "./organizationRecord.js";

export interface OrganizationRepository {
  read(): Promise<OrganizationRecord | null>;
  create(input: {
    domain: string;
    displayName: string;
    requiredDomain: string;
    publicAddress: string;
    administratorAddress: string;
  }): Promise<OrganizationRecord>;
  remove(): Promise<void>;
}
