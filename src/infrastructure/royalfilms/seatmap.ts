import { style } from "../../shared/output.ts";

// Shape observed live from
// GET /cinemas/halls/id/{sala}/function/id/{fn}/channel/id/{ch}/user/id/{uid}
export interface SeatCell {
  silla_id: number;
  mapa_sala_coordenada_x: number; // row index (0 .. filas-1)
  mapa_sala_coordenada_y: number; // column index (0 .. columnas-1)
  mapa_sala_estado_silla: number; // 1 normal, 2 preferential
  mapa_sala_tipo_silla: number;
  mapa_sala_numero_silla: string; // e.g. "A17"
  silla_disponible: boolean;
  silla_precio?: { precio_taquilla_silla?: { tipo_silla_id?: number; tipo_silla_precio?: number } }[];
}
export interface SeatMap {
  configuracion_general: { cantidad_max_sillas: number; duracion_tiempo_transaccion: number };
  sala_info: { sala_filas: number; sala_columnas: number };
  mapa_sala: SeatCell[];
}

export function seatPrice(c: SeatCell): number | undefined {
  return c.silla_precio?.[0]?.precio_taquilla_silla?.tipo_silla_precio;
}
function seatTypeId(c: SeatCell): number {
  return c.silla_precio?.[0]?.precio_taquilla_silla?.tipo_silla_id ?? c.mapa_sala_tipo_silla;
}
// Numeric part of the seat label, e.g. "A17" -> "17".
export function seatNumber(c: SeatCell): string {
  return (c.mapa_sala_numero_silla.match(/\d+/)?.[0] ?? "").padStart(2, "0");
}
const rowLetter = (numero: string): string => (numero.match(/^[A-Za-z]+/)?.[0] ?? "?");

// The row letter shown for each grid row — the single source both the painter
// and the seat resolver read, so what you type always matches what you see.
export function rowLabelsOf(map: SeatMap): string[] {
  const labels: string[] = Array(map.sala_info.sala_filas).fill("");
  for (const c of map.mapa_sala) {
    const x = c.mapa_sala_coordenada_x;
    if (x >= 0 && x < labels.length && !labels[x]) labels[x] = rowLetter(c.mapa_sala_numero_silla);
  }
  return labels;
}

// Resolve user tokens against a seat map by the label the reader SEES
// (rowLabel + number, e.g. "G75"), plus the raw label and the silla_id as
// fallbacks. Some halls number seats globally, so the label's own letter can
// differ from its grid row — this keys off the displayed row letter instead.
export function resolveSeatsOnMap(
  tokens: string[],
  map: SeatMap,
): { seats: { id: number; numero: string }[]; problems: string[] } {
  const rows = rowLabelsOf(map);
  const byKey = new Map<string, SeatCell>();
  const add = (k: string, c: SeatCell) => { if (k) byKey.set(k.toUpperCase(), c); };
  for (const c of map.mapa_sala) {
    const num = c.mapa_sala_numero_silla.match(/\d+/)?.[0] ?? "";
    const row = rows[c.mapa_sala_coordenada_x] ?? "";
    add(`${row}${num}`, c);                        // as shown, e.g. G75
    add(`${row}${num.padStart(2, "0")}`, c);       // padded, e.g. G07
    add(c.mapa_sala_numero_silla, c);              // raw label
    add(String(c.silla_id), c);                    // silla id
  }
  const seats: { id: number; numero: string }[] = [];
  const problems: string[] = [];
  for (const raw of tokens) {
    const tok = raw.trim();
    if (!tok) continue;
    const cell = byKey.get(tok.toUpperCase());
    if (!cell) problems.push(`"${tok}" no existe en esta sala`);
    else if (!cell.silla_disponible) problems.push(`${tok} ya está ocupada`);
    else if (seats.some((s) => s.id === cell.silla_id)) continue;
    else seats.push({ id: cell.silla_id, numero: cell.mapa_sala_numero_silla });
  }
  return { seats, problems };
}

export interface PriceTier {
  tipo_silla_id: number;
  nombre?: string;
  precio: number;
  total: number;
  disponibles: number;
}
export interface SeatSummary {
  filas: number;
  columnas: number;
  total: number;
  disponibles: number;
  ocupadas: number;
  maxPorCompra: number;
  precioMin?: number;
  precioMax?: number;
  tiers: PriceTier[];
}

export function summarize(map: SeatMap, typeNames?: Map<number, string>): SeatSummary {
  const cells = map.mapa_sala;
  const prices = cells.map(seatPrice).filter((p): p is number => typeof p === "number");
  // group by (tipo, precio)
  const key = (c: SeatCell) => `${seatTypeId(c)}|${seatPrice(c) ?? 0}`;
  const groups = new Map<string, PriceTier>();
  for (const c of cells) {
    const k = key(c);
    let t = groups.get(k);
    if (!t) {
      t = { tipo_silla_id: seatTypeId(c), nombre: typeNames?.get(seatTypeId(c)), precio: seatPrice(c) ?? 0, total: 0, disponibles: 0 };
      groups.set(k, t);
    }
    t.total += 1;
    if (c.silla_disponible) t.disponibles += 1;
  }
  return {
    filas: map.sala_info.sala_filas,
    columnas: map.sala_info.sala_columnas,
    total: cells.length,
    disponibles: cells.filter((c) => c.silla_disponible).length,
    ocupadas: cells.filter((c) => !c.silla_disponible).length,
    maxPorCompra: map.configuracion_general.cantidad_max_sillas,
    precioMin: prices.length ? Math.min(...prices) : undefined,
    precioMax: prices.length ? Math.max(...prices) : undefined,
    tiers: [...groups.values()].sort((a, b) => a.precio - b.precio),
  };
}

// Paint the hall to stdout: each seat is a boxed cell [15]; taken seats are [··];
// chosen seats are highlighted. A wide screen bar sits above the map.
export function paintSeatMap(map: SeatMap, selectedIds: Set<number> = new Set()): void {
  const { sala_filas, sala_columnas } = map.sala_info;
  const grid: (SeatCell | undefined)[][] = Array.from({ length: sala_filas }, () =>
    Array<SeatCell | undefined>(sala_columnas).fill(undefined),
  );
  const rowLabels = rowLabelsOf(map);
  for (const c of map.mapa_sala) {
    const x = c.mapa_sala_coordenada_x;
    const y = c.mapa_sala_coordenada_y;
    if (x >= 0 && x < sala_filas && y >= 0 && y < sala_columnas) grid[x][y] = c;
  }

  const CELL = 5; // "[15] "
  const gutter = 3; // "A  "
  const width = sala_columnas * CELL;

  // Bigger screen: a full-width curved bar with the label centered.
  const label = "  P A N T A L L A  ";
  const side = Math.max(2, Math.floor((width - label.length) / 2));
  const bar = "─".repeat(side) + label + "─".repeat(Math.max(2, width - side - label.length));
  process.stdout.write("\n" + " ".repeat(gutter) + style.dim("╭" + bar + "╮") + "\n");
  process.stdout.write(" ".repeat(gutter) + style.dim("╰" + "─".repeat(bar.length) + "╯") + "\n\n");

  const box = (inner: string, paint: (s: string) => string): string =>
    paint("[" + inner + "]") + " ";

  for (let x = 0; x < sala_filas; x++) {
    const rl = (rowLabels[x] || " ").padEnd(2, " ");
    let line = style.dim(rl) + " ";
    for (let y = 0; y < sala_columnas; y++) {
      const c = grid[x][y];
      if (!c) {
        line += " ".repeat(CELL);
        continue;
      }
      const n = seatNumber(c);
      if (selectedIds.has(c.silla_id)) line += box(n, (s) => style.cyan(style.bold(s)));
      else if (!c.silla_disponible) line += box("··", style.red);
      else if (c.mapa_sala_estado_silla === 2) line += box(n, style.magenta);
      else line += box(n, style.green);
    }
    process.stdout.write(line.replace(/\s+$/, "") + "\n");
  }

  process.stdout.write(
    "\n" +
      " ".repeat(gutter) +
      [
        style.green("[00]") + " libre",
        style.magenta("[00]") + " especial",
        style.red("[··]") + " ocupada",
        style.cyan("[00]") + " elegida",
      ].join("   ") +
      "\n",
  );
}
