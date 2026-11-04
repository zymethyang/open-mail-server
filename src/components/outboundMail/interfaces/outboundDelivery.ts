export interface OutboundDelivery {
  serverDomain: string;
  senderAddress: string;
  recipientAddresses: string[];
  rawMessage: Buffer;
}

export interface SubmissionRelay {
  username: string;
  password: string;
  security: "starttls" | "tls" | "plain";
}
