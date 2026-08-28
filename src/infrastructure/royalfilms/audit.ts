// Append-only audit log for mutations. Two-phase: write a "pending" record
// BEFORE the network call, then a "final" record with the same id after, so a
// crash mid-flight leaves an auditable pending entry instead of silence.
// Day-bucketed JSONL under ~/.royalfilms/audit/, owner-only.
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, appendFileSync, chmodSync } from "node:fs";

const DIR = join(homedir(), ".royalfilms", "audit");

function today(): string {
  // Date is fine here (not a workflow); bucket by UTC day.
  return new Date().toISOString().slice(0, 10);
}

function write(record: Record<string, unknown>): void {
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `${today()}.jsonl`);
  appendFileSync(file, JSON.stringify(record) + "\n", { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
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
  return DIR;
}
