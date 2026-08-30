import { test, expect } from "bun:test";
import { resolveSeats, defaultFare } from "./seats.ts";
import type { SeatMap } from "../domain/entities.ts";

// Regression for the interactive-wizard bug: the map painted the number from
// the seat id (a global counter) while the resolver matched the label, so the
// shown "A11" reported "no existe". resolveSeats now accepts what's shown.
const map: SeatMap = {
  rows: [
    { name: "A", seats: [
      { id: "9", label: "A1", row: "A", column: 1, available: true },
      { id: "75", label: "A11", row: "A", column: 11, available: true },   // id ≠ label number
      { id: "76", label: "A12", row: "A", column: 12, available: false },
    ] },
  ],
  columns: 12,
};

test("resolves the label the map shows", () => {
  expect(resolveSeats(["A11"], map).seats.map((s) => s.label)).toEqual(["A11"]); // as painted
  expect(resolveSeats(["a11"], map).seats.map((s) => s.label)).toEqual(["A11"]); // case-insensitive
  expect(resolveSeats(["75"], map).seats.map((s) => s.label)).toEqual(["A11"]);  // id fallback
  expect(resolveSeats([" A1 "], map).seats.map((s) => s.label)).toEqual(["A1"]); // trimmed
});

test("reports taken and unknown seats", () => {
  expect(resolveSeats(["A12"], map).problems).toEqual(["A12 ya está ocupada"]);
  expect(resolveSeats(["Z9"], map).problems).toEqual(['"Z9" no existe en esta sala']);
});

test("dedupes repeats", () => {
  expect(resolveSeats(["A11", "A11"], map).seats.length).toBe(1);
});

test("defaultFare prefers the cheapest general ticket", () => {
  const f = defaultFare([
    { code: "vip", name: "Preferencial", priceCents: 30000 },
    { code: "gen", name: "General", priceCents: 25000 },
  ] as any);
  expect(f?.code).toBe("gen");
});
