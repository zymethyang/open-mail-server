export interface CertificateDescription {
  subject: string;
  issuer: string;
  validFrom: string;
  validUntil: string;
  names: string[];
  selfSigned: boolean;
  intermediateCount: number;
  daysRemaining: number;
  renewalRequired: boolean;
}
