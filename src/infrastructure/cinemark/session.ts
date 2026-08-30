// Cinemark session store. The reusable credential is the device fingerprint
// JWT (x-fingerprint-id, ~24h) — the seatmap/order/pay calls authenticate with
// it, not with the short-lived (~5min) LoyaltySessionToken. So we persist the
// fingerprint + member under ~/.cinesco/cinemark-session.json (mode 600) and
// mint a fresh userSessionId per restored order flow.
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import type { Member } from "../../domain/entities.ts";

const DIR = join(homedir(), ".cinesco");
const FILE = join(DIR, "cinemark-session.json");

export interface CinemarkSession {
  fingerprint: string;
  member: Member;
  exp: number; // unix seconds (from the fingerprint JWT)
}

export function saveCinemark(s: CinemarkSession): CinemarkSession {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600); // enforce even if it pre-existed
  return s;
}

export function loadCinemark(): CinemarkSession | null {
  if (!existsSync(FILE)) return null;
  try { return JSON.parse(readFileSync(FILE, "utf8")) as CinemarkSession; } catch { return null; }
}

export function clearCinemark(): boolean {
  if (!existsSync(FILE)) return false;
  rmSync(FILE);
  return true;
}

export function cinemarkExpired(s: CinemarkSession, skewSeconds = 60): boolean {
  if (!s.exp) return false;
  return Date.now() / 1000 >= s.exp - skewSeconds;
}

export function cinemarkFile(): string {
  return FILE;
}
