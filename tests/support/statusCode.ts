export function statusCodeOf(error: unknown): number {
  if (!error || typeof error !== "object" || !("statusCode" in error)) {
    return 0;
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : 0;
}
