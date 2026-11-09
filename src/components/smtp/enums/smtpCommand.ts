export enum SmtpCommand {
  ExtendedHello = "EHLO",
  Hello = "HELO",
  NoOperation = "NOOP",
  Reset = "RSET",
  Quit = "QUIT",
  Help = "HELP",
  Verify = "VRFY",
  Expand = "EXPN",
  StartTls = "STARTTLS",
  Authenticate = "AUTH",
  Mail = "MAIL",
  Recipient = "RCPT",
  Data = "DATA"
}
