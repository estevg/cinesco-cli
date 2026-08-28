import { test, expect } from "bun:test";

const BIN = ["bun", "src/presentation/cinesco.ts"];
const root = import.meta.dir + "/../..";
const run = (args: string[]) => Bun.spawnSync([...BIN, ...args], { cwd: root });

test("doctor --json returns a checks envelope with nextSteps", () => {
  const proc = run(["doctor", "--json"]);
  expect(proc.exitCode).toBe(0);
  const env = JSON.parse(proc.stdout.toString().trim());
  expect(env.command).toBe("doctor");
  expect(Array.isArray(env.data)).toBe(true);
  expect(env.data.some((c: { check: string }) => c.check === "agent-browser")).toBe(true);
  expect(Array.isArray(env.nextSteps)).toBe(true);
});

test("skills --json serves the agent manual", () => {
  const proc = run(["skills", "--json"]);
  expect(proc.exitCode).toBe(0);
  const env = JSON.parse(proc.stdout.toString().trim());
  expect(env.data.manual).toContain("agent-browser");
  expect(env.data.manual).toContain("NEVER charges");
});

test("providers --json lists the three chains", () => {
  const proc = run(["providers", "--json"]);
  const env = JSON.parse(proc.stdout.toString().trim());
  expect(env.data.map((p: { id: string }) => p.id).sort()).toEqual(["cinecolombia", "cinemark", "royalfilms"]);
});

test("machine output carries no ANSI escapes", () => {
  const out = run(["doctor", "--json"]).stdout.toString();
  // eslint-disable-next-line no-control-regex
  expect(/\x1b\[/.test(out)).toBe(false);
});
