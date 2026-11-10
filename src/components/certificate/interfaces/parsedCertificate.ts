import type { X509Certificate } from "node:crypto";

export interface ParsedCertificate {
  pem: string;
  certificate: X509Certificate;
}
