export enum WorkerMessageKind {
  ResolveMailExchange = "resolve-mail-exchange",
  ResolveAuthText = "resolve-auth-text",
  ResolveAuthAddresses = "resolve-auth-addresses",
  ResolveAuthMx = "resolve-auth-mx",
  ParentResponse = "parent-response",
  Listening = "listening",
  Listeners = "listeners",
  Ready = "ready",
  Failed = "failed",
  Stop = "stop",
  ShutdownRequested = "shutdown-requested"
}
