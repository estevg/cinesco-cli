// Append-only audit log for mutations, chain-agnostic. Two-phase: write a
// "pending" record BEFORE the network call, then a "final" record with the same
// id after, so a process killed mid-flight leaves an auditable pending entry
// (with the reserva/order id) instead of silence. Day-bucketed JSONL under
// ~/.cinesco/audit/, owner-only. Never write secrets or credentials here —
// identifiers only. CINESCO_AUDIT_DIR overrides the location (used by tests).
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, appendFileSync, chmodSync } from "node:fs";

// Read lazily so CINESCO_AUDIT_DIR set after import (e.g. in tests) still applies.
function dir(): string {
  return process.env.CINESCO_AUDIT_DIR || join(homedir(), ".cinesco", "audit");
}

function today(): string {
  return new Date().toISOString().slice(0, 10); // UTC day; fine outside a workflow
}

function write(record: Record<string, unknown>): void {
  const DIR = dir();
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `${today()}.jsonl`);
  appendFileSync(file, JSON.stringify(record) + "\n", { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}

let counter = 0;
function newId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

export interface AuditHandle {
  id: string;
  final: (outcome: "ok" | "error", detail?: unknown) => void;
}

// Record an intent, returning a handle to close it once the call resolves.
export function auditPending(action: string, request: Record<string, unknown>): AuditHandle {
  const id = newId();
  write({ id, ts: new Date().toISOString(), action, phase: "pending", request });
  return {
    id,
    final(outcome, detail) {
      write({ id, ts: new Date().toISOString(), action, phase: "final", outcome, detail });
    },
  };
}

export function auditDir(): string {
  return dir();
}
