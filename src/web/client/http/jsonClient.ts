export async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = payload as { error?: string };
    throw new Error(failure.error || "Request failed");
  }
  return payload as T;
}
