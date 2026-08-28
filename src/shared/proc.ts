// Node-compatible process helpers (so the bundle runs on Node, not only Bun).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Fire-and-forget, detached launch — opening a browser or a file.
export function launch(cmd: string, args: string[]): void {
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best effort */
  }
}

// Synchronous capture of a command's output.
export function runSync(cmd: string, args: string[], timeoutMs = 20000): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { timeout: timeoutMs, encoding: "utf8" });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// Is a binary on PATH? (replaces Bun.which)
export function which(bin: string): string | null {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = join(dir, bin + ext);
      if (existsSync(full)) return full;
    }
  }
  return null;
}
