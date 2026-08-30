import { test, expect } from "bun:test";
import { soldFraction, occupancyWord, occupancyBar, occupancyLine } from "./occupancy.ts";

// The whole point of the helper: an empty room reads "vacía", a full one "AGOTADA".
// These pin the DIRECTION so the inversion can't come back.
test("sold fraction grows as free shrinks", () => {
  expect(soldFraction(100, 100)).toBe(0);   // all free → nothing sold
  expect(soldFraction(0, 100)).toBe(1);      // none free → sold out
  expect(soldFraction(75, 100)).toBeCloseTo(0.25);
});

test("word matches occupancy, not availability", () => {
  expect(occupancyWord(soldFraction(117, 117))).toBe("vacía");     // empty room
  expect(occupancyWord(soldFraction(0, 117))).toBe("AGOTADA");     // full room
  expect(occupancyWord(soldFraction(58, 117))).toBe("media");
});

test("bar length grows with what's sold", () => {
  expect(occupancyBar(0, 10)).toBe("░".repeat(10));
  expect(occupancyBar(1, 10)).toBe("█".repeat(10));
  expect([...occupancyBar(0.5, 10)].filter((c) => c === "█").length).toBe(5);
});

test("degenerate totals don't divide by zero", () => {
  expect(soldFraction(0, 0)).toBe(0);
  expect(occupancyLine(0, 0).text).toContain("0% ocupada");
});

test("line reports free count and stays aligned width", () => {
  const a = occupancyLine(103, 117);
  const b = occupancyLine(2, 117);
  expect(a.text).toContain("103 de 117 libres");
  // bar segment is the same visible width regardless of value (grid alignment)
  const bar = (s: string) => s.split("  ")[0];
  expect(bar(a.text).length).toBe(bar(b.text).length);
});
