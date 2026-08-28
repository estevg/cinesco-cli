// Pure helpers for the interactive purchase wizard. Kept separate from the
// prompt loop so they can be unit-tested without a TTY.

export interface FunctionCell {
  funcion_id: number;
  funcion_fecha: string; // "2026-08-23"
  funcion_sala_id: number;
  funcion_multicine_id: number;
  funcion_hora_inicio: string; // "1970-01-01T19:20:00.000Z" — a fake date holding the local time
  formato?: { formato_nombre?: string };
  version?: { version_nombre?: string };
  multicine?: { multicine_nombre?: string };
  sala?: { sala_nombre?: string };
}

// The stored time is a placeholder date carrying HH:MM. Take the literal clock
// value (positions 11..16) — do NOT timezone-convert it.
export function funcTime(f: FunctionCell): string {
  const t = f.funcion_hora_inicio || "";
  const m = t.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "--:--";
}

export function funcLabel(f: FunctionCell): string {
  const parts = [
    funcTime(f),
    f.multicine?.multicine_nombre,
    f.sala?.sala_nombre,
    [f.formato?.formato_nombre, f.version?.version_nombre].filter(Boolean).join(" "),
  ].filter(Boolean);
  return parts.join(" · ");
}

// Same, without the cinema name — used when functions are already grouped by cinema.
export function funcLabelShort(f: FunctionCell): string {
  const parts = [
    funcTime(f),
    f.sala?.sala_nombre,
    [f.formato?.formato_nombre, f.version?.version_nombre].filter(Boolean).join(" "),
  ].filter(Boolean);
  return parts.join(" · ");
}

// Group a day's functions by cinema, preserving first-seen order.
export function groupByCinema(
  functions: FunctionCell[],
): { multicineId: number; nombre: string; funciones: FunctionCell[] }[] {
  const order: number[] = [];
  const map = new Map<number, { nombre: string; funciones: FunctionCell[] }>();
  for (const f of functions) {
    const id = f.funcion_multicine_id;
    if (!map.has(id)) {
      map.set(id, { nombre: f.multicine?.multicine_nombre ?? `Cine ${id}`, funciones: [] });
      order.push(id);
    }
    map.get(id)!.funciones.push(f);
  }
  return order.map((id) => ({
    multicineId: id,
    nombre: map.get(id)!.nombre,
    funciones: map.get(id)!.funciones.sort((a, b) => funcTime(a).localeCompare(funcTime(b))),
  }));
}

// Group functions by date, preserving first-seen date order.
export function groupByDate(functions: FunctionCell[]): { fecha: string; funciones: FunctionCell[] }[] {
  const order: string[] = [];
  const map = new Map<string, FunctionCell[]>();
  for (const f of functions) {
    if (!map.has(f.funcion_fecha)) {
      map.set(f.funcion_fecha, []);
      order.push(f.funcion_fecha);
    }
    map.get(f.funcion_fecha)!.push(f);
  }
  return order.map((fecha) => ({
    fecha,
    funciones: map.get(fecha)!.sort((a, b) => funcTime(a).localeCompare(funcTime(b))),
  }));
}

// Resolve user-typed seat tokens (labels like "F17" or numeric silla_id) against
// the seat map. Returns resolved seats or a list of problems.
export interface SeatLike {
  silla_id: number;
  mapa_sala_numero_silla: string;
  silla_disponible: boolean;
}
export function resolveSeats(
  tokens: string[],
  cells: SeatLike[],
): { seats: { id: number; numero: string }[]; problems: string[] } {
  const byLabel = new Map(cells.map((c) => [c.mapa_sala_numero_silla.toUpperCase(), c]));
  const byId = new Map(cells.map((c) => [String(c.silla_id), c]));
  const seats: { id: number; numero: string }[] = [];
  const problems: string[] = [];
  for (const raw of tokens) {
    const tok = raw.trim();
    if (!tok) continue;
    const cell = byLabel.get(tok.toUpperCase()) ?? byId.get(tok);
    if (!cell) problems.push(`"${tok}" no existe en esta sala`);
    else if (!cell.silla_disponible)
      problems.push(`${cell.mapa_sala_numero_silla} ya está ocupada`);
    else if (seats.some((s) => s.id === cell.silla_id)) continue; // dedupe
    else seats.push({ id: cell.silla_id, numero: cell.mapa_sala_numero_silla });
  }
  return { seats, problems };
}
