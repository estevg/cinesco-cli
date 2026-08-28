import { apiPost, ApiError } from "./api.ts";
import { saveSession, loadSession, isExpired, type Session } from "./session.ts";

// POST /auth/login {email,password} -> {status:true, data:"<JWT>"}. The JWT is the token.
export async function login(email: string, password: string): Promise<Session> {
  const token = await apiPost<string>(`/auth/login`, { email, password });
  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new ApiError("bad-login", "el login no devolvió un token válido");
  }
  return saveSession(token);
}

// Return a live token or throw a structured error telling the caller to log in.
export function requireToken(): { token: string; session: Session } {
  const session = loadSession();
  if (!session) {
    throw new ApiError("not-authenticated", "no hay sesión — corré 'royalfilms auth login'");
  }
  if (isExpired(session)) {
    throw new ApiError("session-expired", "la sesión expiró — corré 'royalfilms auth login'");
  }
  return { token: session.token, session };
}
