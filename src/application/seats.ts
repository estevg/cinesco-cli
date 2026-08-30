// Pure seat helpers — no I/O. Resolve user-typed labels to seats and pick a fare.
import type { Seat, SeatMap, Fare } from "../domain/entities.ts";

export function resolveSeats(labels: string[], map: SeatMap): { seats: Seat[]; problems: string[] } {
  // Index by the seat's own label, by row+number (what the map paints), padded
  // and bare, and by id — so whatever the reader sees resolves, even in halls
  // where the label and the displayed number differ.
  const byKey = new Map<string, Seat>();
  const add = (k: string, s: Seat) => { if (k) byKey.set(k.toUpperCase(), s); };
  for (const r of map.rows) for (const s of r.seats) {
    const num = s.label.match(/\d+/)?.[0] ?? "";
    add(s.label, s);
    add(`${r.name}${num}`, s);
    add(`${r.name}${num.padStart(2, "0")}`, s);
    add(s.id, s);
  }
  const seats: Seat[] = [];
  const problems: string[] = [];
  for (const raw of labels) {
    const tok = raw.trim();
    if (!tok) continue;
    const s = byKey.get(tok.toUpperCase());
    if (!s) problems.push(`"${raw.trim()}" no existe en esta sala`);
    else if (!s.available) problems.push(`${s.label} ya está ocupada`);
    else if (seats.some((x) => x.label === s.label)) continue; // dedupe
    else seats.push(s);
  }
  return { seats, problems };
}

// The cheapest non-special fare, if any; else the cheapest overall.
export function defaultFare(fares: Fare[]): Fare | undefined {
  const usable = fares.filter((f) => f.priceCents > 0);
  const general = usable.filter((f) => !/preferenc|premium|vip|especial/i.test(f.name));
  const pool = general.length ? general : usable.length ? usable : fares;
  return [...pool].sort((a, b) => a.priceCents - b.priceCents)[0];
}
