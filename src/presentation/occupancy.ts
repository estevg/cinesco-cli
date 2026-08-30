// Seat availability reads backwards if you print it raw: a nearly-empty room
// with "98 libres" scans as "98% full". So we present OCCUPANCY (grows with
// what's sold) as a bar + a word, and keep the direction in a named, tested
// helper instead of a hand-written calc at each call site (see cli-build
// human-output: a direction-sensitive metric earns a helper with a test).

// Fraction sold, 0..1. High = full. This is the direction the eye assumes when
// the bar is long, so everything downstream must agree with it.
export function soldFraction(free: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const sold = Math.min(Math.max(total - free, 0), total);
  return sold / total;
}

// A word for the fraction. Buckets chosen so every state actually occurs across
// real showtimes (empty weekday matinees → sold-out premieres).
export function occupancyWord(sold: number): string {
  if (sold >= 1) return "AGOTADA";
  if (sold >= 0.9) return "casi agotada";
  if (sold >= 0.6) return "llena";
  if (sold >= 0.25) return "media";
  return "vacía";
}

// A bar that grows with what's SOLD (not with what's free), so length and
// meaning point the same way. Same-width glyphs so it stays aligned in a grid.
export function occupancyBar(sold: number, width = 12): string {
  const filled = Math.round(Math.min(Math.max(sold, 0), 1) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// One line ready to print: bar · N% ocupada · F de T libres.
export function occupancyLine(free: number, total: number): { sold: number; word: string; text: string } {
  const sold = soldFraction(free, total);
  const pct = Math.round(sold * 100);
  return { sold, word: occupancyWord(sold), text: `${occupancyBar(sold)}  ${pct}% ocupada · ${free} de ${total} libres` };
}
