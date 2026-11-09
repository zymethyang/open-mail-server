export enum Pop3Command {
  Capability = "CAPA",
  StartTls = "STLS",
  User = "USER",
  Password = "PASS",
  Authenticate = "AUTH",
  Quit = "QUIT",
  NoOperation = "NOOP",
  Statistics = "STAT",
  Reset = "RSET",
  List = "LIST",
  UniqueIdentifierList = "UIDL",
  Retrieve = "RETR",
  Top = "TOP",
  Delete = "DELE"
}
