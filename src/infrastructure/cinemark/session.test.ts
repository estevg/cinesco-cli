import { test, expect } from "bun:test";
import { cinemarkExpired, type CinemarkSession } from "./session.ts";

const s = (exp: number): CinemarkSession => ({ fingerprint: "fp", member: { id: "1" }, exp });
const now = () => Math.floor(Date.now() / 1000);

test("a fresh fingerprint (hours left) is not expired", () => {
  expect(cinemarkExpired(s(now() + 3600))).toBe(false);
});

test("a past exp is expired", () => {
  expect(cinemarkExpired(s(now() - 10))).toBe(true);
});

test("the 60s skew treats a nearly-expired token as expired", () => {
  expect(cinemarkExpired(s(now() + 30))).toBe(true);
});

test("a missing exp is treated as non-expiring (never blocks reuse)", () => {
  expect(cinemarkExpired(s(0))).toBe(false);
});
