// Presentation — paint a domain SeatMap to stdout. Two jobs, kept separate
// (human-output "split by actionability"): the GLYPH map lets the eye read the
// room shape in a glance (light ░░ = free, dark ▓▓ = taken), and the per-row
// "libres" list gives the exact labels to type. Shades (not just colour)
// distinguish the states so it still reads under NO_COLOR. One painter, DRY.
import { style } from "../shared/output.ts";
import type { SeatMap } from "../domain/entities.ts";

const seatNum = (label: string, id: string): string => label.match(/\d+/)?.[0] ?? id.match(/\d+/)?.[0] ?? "?";

// Collapse consecutive seat numbers into ranges: [1,2,3,4,7,8,9] → "1-4 7-9".
export function compactRanges(nums: string[]): string {
  const ns = [...new Set(nums.map(Number))].sort((a, b) => a - b);
  if (!ns.length) return "";
  const parts: string[] = [];
  let start = ns[0], prev = ns[0];
  for (let i = 1; i <= ns.length; i++) {
    if (i < ns.length && ns[i] === prev + 1) { prev = ns[i]; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = ns[i];
  }
  return parts.join(" ");
}

export function paintSeatMap(map: SeatMap, selected: Set<string> = new Set()): void {
  const CELL = 3; // "░░ "
  const gutter = 3;
  const width = map.columns * CELL;

  // Screen bar.
  const label = "  P A N T A L L A  ";
  const side = Math.max(2, Math.floor((width - label.length) / 2));
  const bar = "─".repeat(side) + label + "─".repeat(Math.max(2, width - side - label.length));
  process.stdout.write("\n" + " ".repeat(gutter) + style.dim("╭" + bar + "╮") + "\n");
  process.stdout.write(" ".repeat(gutter) + style.dim("╰" + "─".repeat(bar.length) + "╯") + "\n\n");

  let hasSpecial = false, hasTaken = false;
  const freeByRow: { row: string; nums: string[] }[] = [];

  for (const r of map.rows) {
    const byCol = new Map(r.seats.map((s) => [s.column, s]));
    let line = style.dim((r.name || " ").padEnd(2, " ")) + " ";
    const free: string[] = [];
    for (let c = 1; c <= map.columns; c++) {
      const s = byCol.get(c);
      if (!s) { line += " ".repeat(CELL); continue; }
      if (s.special) hasSpecial = true;
      let glyph: string;
      if (selected.has(s.label)) glyph = style.cyan(style.bold("██"));   // your pick
      else if (!s.available) { glyph = style.dim("▓▓"); hasTaken = true; } // taken (dark, recedes)
      else if (s.special) { glyph = style.magenta("▒▒"); free.push(seatNum(s.label, s.id)); } // preferential
      else { glyph = style.green("░░"); free.push(seatNum(s.label, s.id)); }                    // free (light, pops)
      line += glyph + " ";
    }
    process.stdout.write(line.replace(/\s+$/, "") + "\n");
    if (free.length) freeByRow.push({ row: r.name || "?", nums: free.sort((a, b) => Number(a) - Number(b)) });
  }

  // Legend — fully derived: each state shows only when it's on the map, so it
  // can't advertise a category the room doesn't have (human-output).
  const legend = [
    style.green("░░") + " libre",
    ...(hasSpecial ? [style.magenta("▒▒") + " preferencial"] : []),
    ...(hasTaken ? [style.dim("▓▓") + " ocupada"] : []),
    ...(selected.size ? [style.cyan("██") + " elegida"] : []),
  ];
  process.stdout.write("\n" + " ".repeat(gutter) + legend.join("   ") + "\n");

  // How to pick: the map shows the shape; this gives the labels to type.
  if (freeByRow.length) {
    const ej = `${freeByRow[0].row}${freeByRow[0].nums[0]}`;
    process.stdout.write("\n" + " ".repeat(gutter) + style.dim(`elegí por fila+número (ej ${ej}):`) + "\n");
    for (const { row, nums } of freeByRow) {
      process.stdout.write(" ".repeat(gutter) + style.cyan(row.padEnd(2)) + "  " + compactRanges(nums) + "\n");
    }
  }
}
