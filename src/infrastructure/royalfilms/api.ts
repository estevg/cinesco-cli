// Thin fetch wrapper over the Royal Films public API.
// Base and endpoints recovered + verified against the live site.
// Envelope from the API is uniform: {status:boolean, data|message}.
// Quirk documented in recon: auth failures return HTTP 401 with status:true;
// business errors return HTTP 200/422 with status:false. We treat either as failure.

export const BASE = "https://cinemasroyalfilms.com/api";

const UA =
  "royalfilms-cli/0.1.0 (+https://github.com/) node-fetch";

export class ApiError extends Error {
  code: string;
  httpStatus?: number;
  constructor(code: string, message: string, httpStatus?: number) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface ApiEnvelope<T> {
  status: boolean;
  data?: T;
  message?: string;
}

function authHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json", "User-Agent": UA };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function apiGet<T = unknown>(path: string, token?: string): Promise<T> {
  const url = `${BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: authHeaders(token) });
  } catch (e) {
    throw new ApiError("network", `no se pudo alcanzar ${url}: ${(e as Error).message}`);
  }

  const text = await res.text();
  return handle<T>(text, res, path);
}

export async function apiPost<T = unknown>(
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const url = `${BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError("network", `no se pudo alcanzar ${url}: ${(e as Error).message}`);
  }
  const text = await res.text();
  return handle<T>(text, res, path);
}

export async function apiDelete<T = unknown>(path: string, token?: string): Promise<T> {
  const url = `${BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "DELETE", headers: authHeaders(token) });
  } catch (e) {
    throw new ApiError("network", `no se pudo alcanzar ${url}: ${(e as Error).message}`);
  }
  const text = await res.text();
  return handle<T>(text, res, path);
}

function handle<T>(text: string, res: Response, path: string): T {
  let body: ApiEnvelope<T>;
  try {
    body = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(
      "bad-response",
      `respuesta no-JSON de ${path} (HTTP ${res.status})`,
      res.status,
    );
  }

  // HTTP 401 with status:true is the API's "unauthorized" shape (recon quirk).
  if (res.status === 401) {
    throw new ApiError(
      "unauthorized",
      body.message || "sesión inválida o expirada — corré 'royalfilms auth login'",
      401,
    );
  }
  if (body.status === false) {
    throw new ApiError("api-error", body.message || `el endpoint reportó un error`, res.status);
  }
  if (!res.ok) {
    throw new ApiError("http-error", body.message || `HTTP ${res.status}`, res.status);
  }
  return (body.data as T) ?? ([] as unknown as T);
}
