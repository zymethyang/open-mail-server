let csrfToken = "";

export function setCsrfToken(token: string): void {
  csrfToken = token;
  if (typeof window !== "undefined") {
    (window as unknown as { __csrfToken?: string }).__csrfToken = token;
  }
}

export async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const method = (options.method || "GET").toUpperCase();
  if (csrfToken && method !== "GET" && method !== "HEAD") {
    headers.set("X-CSRF-Token", csrfToken);
  }
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