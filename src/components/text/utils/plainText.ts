export function oneLine(value: unknown, maximum = 400): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maximum);
}

export function cleanDisplayName(value: unknown): string {
  return oneLine(value, 80);
}
