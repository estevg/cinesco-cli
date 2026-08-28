// Pure seat helpers — no I/O. Resolve user-typed labels to seats and pick a fare.
import type { Seat, SeatMap, Fare } from "../domain/entities.ts";

export function resolveSeats(labels: string[], map: SeatMap): { seats: Seat[]; problems: string[] } {
  const byLabel = new Map<string, Seat>();
  for (const r of map.rows) for (const s of r.seats) byLabel.set(s.label.toUpperCase(), s);
  const seats: Seat[] = [];
  const problems: string[] = [];
  for (const raw of labels) {
    const tok = raw.trim().toUpperCase();
    if (!tok) continue;
    const s = byLabel.get(tok);
    if (!s) problems.push(`"${raw}" no existe en esta sala`);
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
