import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditPending, auditDir } from "./audit.ts";

function withTempAudit<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "cinesco-audit-"));
  const prev = process.env.CINESCO_AUDIT_DIR;
  process.env.CINESCO_AUDIT_DIR = dir;
  try { return fn(dir); } finally { if (prev === undefined) delete process.env.CINESCO_AUDIT_DIR; else process.env.CINESCO_AUDIT_DIR = prev; }
}

function records(dir: string): any[] {
  const day = new Date().toISOString().slice(0, 10);
  const file = join(dir, `${day}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("two-phase: pending is written before the call, final shares the id", () => {
  withTempAudit((dir) => {
    const h = auditPending("cinemark.order", { seats: ["F6"], cinema: "2401" });
    // Simulates a process killed here: only the pending record exists, with the intent.
    let mid = records(dir);
    expect(mid.length).toBe(1);
    expect(mid[0]).toMatchObject({ id: h.id, action: "cinemark.order", phase: "pending" });
    expect(mid[0].request).toEqual({ seats: ["F6"], cinema: "2401" });

    h.final("ok", { orderId: "ABC" });
    const all = records(dir);
    expect(all.length).toBe(2);
    expect(all[1]).toMatchObject({ id: h.id, phase: "final", outcome: "ok" });
    expect(all[1].detail).toEqual({ orderId: "ABC" });
  });
});

test("the log file is owner-only (0600)", () => {
  withTempAudit((dir) => {
    auditPending("royalfilms.cancel", { reservaId: 1 }).final("ok");
    const day = new Date().toISOString().slice(0, 10);
    const mode = statSync(join(dir, `${day}.jsonl`)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

test("ids are unique across calls", () => {
  withTempAudit(() => {
    const a = auditPending("x", {}).id;
    const b = auditPending("x", {}).id;
    expect(a).not.toBe(b);
  });
});

test("auditDir reflects the override", () => {
  withTempAudit((dir) => expect(auditDir()).toBe(dir));
});
