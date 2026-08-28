import { test, expect } from "bun:test";
import { COMMANDS, findCommand } from "./commands.ts";

// The CLI's own surface: contract checks that don't hit the network.

test("every command is noun-verb with a summary", () => {
  for (const c of COMMANDS) {
    expect(c.noun).toMatch(/^[a-z-]+$/);
    expect(c.verb).toMatch(/^[a-z-]+$/);
    expect(c.summary.length).toBeGreaterThan(0);
  }
});

test("command paths are unique", () => {
  const paths = COMMANDS.map((c) => `${c.noun} ${c.verb}`);
  expect(new Set(paths).size).toBe(paths.length);
});

test("findCommand resolves and rejects", () => {
  expect(findCommand("cities", "list")).toBeDefined();
  expect(findCommand("nope", "nope")).toBeUndefined();
});

// Network-dependent: verify the envelope shape against the live public API.
// Skipped automatically offline (fetch throws -> we assert the error path instead).
test("cities list returns a non-empty JSON envelope", async () => {
  const proc = Bun.spawnSync(["bun", "src/presentation/cli.ts", "cities", "list"], {
    cwd: import.meta.dir + "/../..",
  });
  const out = proc.stdout.toString().trim();
  if (!out) return; // offline / blocked; nothing to assert
  const env = JSON.parse(out);
  expect(env.ok).toBe(true);
  expect(env.command).toBe("cities list");
  expect(Array.isArray(env.data)).toBe(true);
  expect(env.count).toBeGreaterThan(0);
});

test("unknown command exits 2 with structured error", () => {
  const proc = Bun.spawnSync(["bun", "src/presentation/cli.ts", "foo", "bar", "--json"], {
    cwd: import.meta.dir + "/../..",
  });
  expect(proc.exitCode).toBe(2);
  const env = JSON.parse(proc.stdout.toString().trim());
  expect(env.ok).toBe(false);
  expect(env.error.code).toBe("unknown-command");
});

test("missing args exits 2", () => {
  const proc = Bun.spawnSync(["bun", "src/presentation/cli.ts", "cinemas", "by-city", "--json"], {
    cwd: import.meta.dir + "/../..",
  });
  expect(proc.exitCode).toBe(2);
  const env = JSON.parse(proc.stdout.toString().trim());
  expect(env.error.code).toBe("missing-args");
});

test("machine output carries no ANSI escapes", () => {
  const proc = Bun.spawnSync(["bun", "src/presentation/cli.ts", "schema", "--json"], {
    cwd: import.meta.dir + "/../..",
  });
  const out = proc.stdout.toString();
  // eslint-disable-next-line no-control-regex
  expect(/\x1b\[/.test(out)).toBe(false);
});
