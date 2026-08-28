// Presentation — paint a domain SeatMap to stdout (Royal Films look): a curved screen
// bar, boxed [NN] cells (green free · magenta special · red [··] taken · cyan chosen),
// row labels, legend. One painter for every chain (DRY). `selected` holds seat labels.
import { style } from "../shared/output.ts";
import type { SeatMap } from "../domain/entities.ts";

export function paintSeatMap(map: SeatMap, selected: Set<string> = new Set()): void {
  const CELL = 5; // "[15] "
  const gutter = 3;
  const width = map.columns * CELL;

  const label = "  P A N T A L L A  ";
  const side = Math.max(2, Math.floor((width - label.length) / 2));
  const bar = "─".repeat(side) + label + "─".repeat(Math.max(2, width - side - label.length));
  process.stdout.write("\n" + " ".repeat(gutter) + style.dim("╭" + bar + "╮") + "\n");
  process.stdout.write(" ".repeat(gutter) + style.dim("╰" + "─".repeat(bar.length) + "╯") + "\n\n");

  const box = (inner: string, paint: (s: string) => string) => paint("[" + inner + "]") + " ";
  let hasSpecial = false;

  for (const r of map.rows) {
    const byCol = new Map(r.seats.map((s) => [s.column, s]));
    let line = style.dim((r.name || " ").padEnd(2, " ")) + " ";
    for (let c = 1; c <= map.columns; c++) {
      const s = byCol.get(c);
      if (!s) {
        line += " ".repeat(CELL);
        continue;
      }
      const n = (s.id.match(/\d+/)?.[0] ?? s.id).padStart(2, "0").slice(-2);
      if (s.special) hasSpecial = true;
      if (selected.has(s.label)) line += box(n, (t) => style.cyan(style.bold(t)));
      else if (!s.available) line += box("··", style.red);
      else if (s.special) line += box(n, style.magenta);
      else line += box(n, style.green);
    }
    process.stdout.write(line.replace(/\s+$/, "") + "\n");
  }

  const legend = [
    style.green("[00]") + " libre",
    ...(hasSpecial ? [style.magenta("[00]") + " preferencial"] : []),
    style.red("[··]") + " ocupada",
    style.cyan("[00]") + " elegida",
  ];
  process.stdout.write("\n" + " ".repeat(gutter) + legend.join("   ") + "\n");
}
