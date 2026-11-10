import type { CertificateDescription } from "./certificateDescription.js";

export interface PreparedCertificate {
  description: CertificateDescription;
  certificate: string;
  privateKey: string;
}
