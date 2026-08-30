import { test, expect } from "bun:test";
import { compactRanges } from "./seatmap.ts";

test("collapses consecutive seat numbers into ranges", () => {
  expect(compactRanges(["1", "2", "3", "4", "7", "8", "9"])).toBe("1-4 7-9");
  expect(compactRanges(["5"])).toBe("5");
  expect(compactRanges(["3", "1", "2"])).toBe("1-3");          // sorts first
  expect(compactRanges(["1", "1", "2"])).toBe("1-2");          // dedupes
  expect(compactRanges(["2", "4", "6"])).toBe("2 4 6");        // no runs
  expect(compactRanges([])).toBe("");
});
