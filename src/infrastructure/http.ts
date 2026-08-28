// Shared HTTP helpers used by every adapter (DRY). Thin JSON wrappers over fetch that
// surface failures as errors the domain layer understands.
import { DomainError } from "../domain/errors.ts";

export interface HttpOptions {
  headers?: Record<string, string>;
}

async function request(url: string, method: string, body: unknown, opts?: HttpOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json, text/plain, */*", ...opts?.headers };
  if (body !== undefined) headers["Content-Type"] ??= "application/json";
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new DomainError(`${method} ${url} → ${res.status}: ${text.slice(0, 200)}`, "http");
  }
  return res;
}

export async function getJson<T>(url: string, opts?: HttpOptions): Promise<T> {
  return (await (await request(url, "GET", undefined, opts)).json()) as T;
}

export async function postJson<T>(url: string, body: unknown, opts?: HttpOptions): Promise<T> {
  return (await (await request(url, "POST", body, opts)).json()) as T;
}

// POST that also exposes response headers (e.g. Cinemark's x-fingerprint-id).
export async function postJsonWithHeaders<T>(
  url: string,
  body: unknown,
  opts?: HttpOptions,
): Promise<{ data: T; headers: Headers }> {
  const res = await request(url, "POST", body, opts);
  return { data: (await res.json()) as T, headers: res.headers };
}
