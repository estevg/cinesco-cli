// Local session store. The API's credential IS a JWT returned by /auth/login;
// we persist that token (never the password) under ~/.royalfilms/session.json
// with owner-only permissions, and replay it headless until it expires.
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";

const DIR = join(homedir(), ".royalfilms");
const FILE = join(DIR, "session.json");

export interface StoredUser {
  id: number;
  nombres?: string;
  apellidos?: string;
  correo?: string;
  ciudad?: number;
}

export interface Session {
  token: string;
  user: StoredUser;
  exp: number; // unix seconds
}

// Decode a JWT payload (no signature check — we only read claims we own).
export function decodeJwt(token: string): { user?: Record<string, unknown>; exp?: number } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("token no es un JWT");
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const json = Buffer.from(pad, "base64").toString("utf8");
  return JSON.parse(json);
}

export function userFromToken(token: string): { user: StoredUser; exp: number } {
  const payload = decodeJwt(token);
  const u = (payload.user ?? {}) as Record<string, unknown>;
  const id = Number(u.usuario_cliente_id);
  if (!id) throw new Error("el token no contiene usuario_cliente_id");
  return {
    exp: Number(payload.exp) || 0,
    user: {
      id,
      nombres: u.usuario_cliente_nombres as string | undefined,
      apellidos: u.usuario_cliente_apellidos as string | undefined,
      correo: u.usuario_cliente_correo as string | undefined,
      ciudad: u.usuario_cliente_ciudad != null ? Number(u.usuario_cliente_ciudad) : undefined,
    },
  };
}

export function saveSession(token: string): Session {
  const { user, exp } = userFromToken(token);
  const session: Session = { token, user, exp };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600); // enforce even if the file pre-existed
  return session;
}

export function loadSession(): Session | null {
  if (!existsSync(FILE)) return null;
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Session;
  } catch {
    return null;
  }
}

export function clearSession(): boolean {
  if (!existsSync(FILE)) return false;
  rmSync(FILE);
  return true;
}

export function isExpired(session: Session, skewSeconds = 30): boolean {
  if (!session.exp) return false;
  return Date.now() / 1000 >= session.exp - skewSeconds;
}

export function sessionFilePath(): string {
  return FILE;
}
