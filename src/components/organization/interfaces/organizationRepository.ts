import type { OrganizationRecord } from "./organizationRecord.js";

export interface OrganizationRepository {
  read(): Promise<OrganizationRecord | null>;
  create(input: { domain: string; displayName: string; requiredDomain: string }): Promise<OrganizationRecord>;
  remove(): Promise<void>;
}
