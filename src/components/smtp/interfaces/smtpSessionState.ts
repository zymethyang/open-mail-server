export interface SmtpSessionState {
  secure: boolean;
  greeted: boolean;
  mailAccepted: boolean;
  accountAddress: string;
  senderAddress: string;
  recipients: string[];
  authenticationStep: "" | "login-username" | "login-password" | "plain";
  authenticationUsername: string;
  remoteAddress: string;
}
