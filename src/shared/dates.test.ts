import { test, expect } from "bun:test";
import { resolveDate } from "./dates.ts";

// Fixed reference: 2026-08-28 is a Friday.
const friday = new Date(2026, 7, 28);

test("hoy / mañana / pasado", () => {
  expect(resolveDate("hoy", friday)).toBe("2026-08-28");
  expect(resolveDate("mañana", friday)).toBe("2026-08-29");
  expect(resolveDate("pasado", friday)).toBe("2026-08-30");
});

test("weekday = upcoming (today if it matches)", () => {
  expect(resolveDate("viernes", friday)).toBe("2026-08-28"); // today is Friday
  expect(resolveDate("sábado", friday)).toBe("2026-08-29");
  expect(resolveDate("lunes", friday)).toBe("2026-08-31");
});

test("explicit ISO passes through; unknown is null", () => {
  expect(resolveDate("2026-12-25", friday)).toBe("2026-12-25");
  expect(resolveDate("cualquiera", friday)).toBeNull();
});
