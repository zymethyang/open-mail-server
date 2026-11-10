export function consoleVisitorIsLocal(remoteAddress: string): boolean {
  const address = remoteAddress.trim().toLowerCase().replace(/^::ffff:/i, "");
  return address === "127.0.0.1" || address === "::1";
}

export function consoleAllowsVisitor(remoteAddress: string, companyAccountExists: boolean): boolean {
  return companyAccountExists || consoleVisitorIsLocal(remoteAddress);
}
