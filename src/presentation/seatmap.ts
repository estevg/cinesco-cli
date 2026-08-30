// Presentation — paint a domain SeatMap to stdout. Each free seat shows the
// number you'd type ([11] green, [07] magenta = preferential), taken seats
// recede as dim [··], your pick is cyan — so you read a seat and its label in
// one place and pick it directly. The occupancy bar printed above the map
// (by the seats command) carries the at-a-glance "how full" read. One painter
// for every chain (DRY), used by both `seats` and the wizard.
import { style } from "../shared/output.ts";
import type { SeatMap } from "../domain/entities.ts";

export function paintSeatMap(map: SeatMap, selected: Set<string> = new Set()): void {
  const CELL = 5; // "[15] "
  const gutter = 3;
  const width = map.columns * CELL;

  // Screen bar.
  const label = "  P A N T A L L A  ";
  const side = Math.max(2, Math.floor((width - label.length) / 2));
  const bar = "─".repeat(side) + label + "─".repeat(Math.max(2, width - side - label.length));
  process.stdout.write("\n" + " ".repeat(gutter) + style.dim("╭" + bar + "╮") + "\n");
  process.stdout.write(" ".repeat(gutter) + style.dim("╰" + "─".repeat(bar.length) + "╯") + "\n\n");

  const box = (inner: string, paint: (s: string) => string) => paint("[" + inner + "]") + " ";
  let hasSpecial = false, hasTaken = false;

  for (const r of map.rows) {
    const byCol = new Map(r.seats.map((s) => [s.column, s]));
    let line = style.cyan((r.name || " ").padEnd(2, " ")) + " ";
    for (let c = 1; c <= map.columns; c++) {
      const s = byCol.get(c);
      if (!s) { line += " ".repeat(CELL); continue; }
      // The number is the seat's LABEL (what you type), not its internal id.
      const n = (s.label.match(/\d+/)?.[0] ?? s.id.match(/\d+/)?.[0] ?? "?").padStart(2, "0").slice(-2);
      if (selected.has(s.label)) line += box(n, (t) => style.cyan(style.bold(t)));
      else if (!s.available) { line += box("··", style.dim); hasTaken = true; }
      else if (s.special) { line += box(n, style.magenta); hasSpecial = true; }
      else line += box(n, style.green);
    }
    process.stdout.write(line.replace(/\s+$/, "") + "\n");
  }

  // Legend — fully derived: a state shows only when it's on the map.
  const legend = [
    style.green("[07]") + " libre",
    ...(hasSpecial ? [style.magenta("[07]") + " preferencial"] : []),
    ...(hasTaken ? [style.dim("[··]") + " ocupada"] : []),
    ...(selected.size ? [style.cyan("[07]") + " elegida"] : []),
  ];
  process.stdout.write("\n" + " ".repeat(gutter) + legend.join("   ") + "\n");
  process.stdout.write(" ".repeat(gutter) + style.dim("escribí fila+número (ej A7, o varias con coma: A7,A8)") + "\n");
}
