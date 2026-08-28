import { test, expect } from "bun:test";
import { funcTime, funcLabel, funcLabelShort, groupByDate, groupByCinema, resolveSeats, type FunctionCell } from "./wizard.ts";

const mk = (over: Partial<FunctionCell>): FunctionCell => ({
  funcion_id: 1,
  funcion_fecha: "2026-08-23",
  funcion_sala_id: 10,
  funcion_multicine_id: 20,
  funcion_hora_inicio: "1970-01-01T19:20:00.000Z",
  ...over,
});

test("funcTime reads the literal clock, no timezone shift", () => {
  expect(funcTime(mk({ funcion_hora_inicio: "1970-01-01T19:20:00.000Z" }))).toBe("19:20");
  expect(funcTime(mk({ funcion_hora_inicio: "bad" }))).toBe("--:--");
});

test("funcLabel composes time, cinema, hall, format", () => {
  const l = funcLabel(
    mk({
      multicine: { multicine_nombre: "Multicine X" },
      sala: { sala_nombre: "SALA 4" },
      formato: { formato_nombre: "2D" },
      version: { version_nombre: "DOB" },
    }),
  );
  expect(l).toBe("19:20 · Multicine X · SALA 4 · 2D DOB");
});

test("funcLabelShort omits the cinema name", () => {
  const f = mk({ sala: { sala_nombre: "SALA 7" }, formato: { formato_nombre: "2D" }, multicine: { multicine_nombre: "X" } });
  expect(funcLabelShort(f)).toBe("19:20 · SALA 7 · 2D");
});

test("groupByCinema groups a day's functions by cinema", () => {
  const fns = [
    mk({ funcion_id: 1, funcion_multicine_id: 10, multicine: { multicine_nombre: "Viva" }, funcion_hora_inicio: "1970-01-01T21:00:00.000Z" }),
    mk({ funcion_id: 2, funcion_multicine_id: 20, multicine: { multicine_nombre: "Unico" } }),
    mk({ funcion_id: 3, funcion_multicine_id: 10, multicine: { multicine_nombre: "Viva" }, funcion_hora_inicio: "1970-01-01T14:00:00.000Z" }),
  ];
  const g = groupByCinema(fns);
  expect(g.map((c) => c.nombre)).toEqual(["Viva", "Unico"]);
  expect(g[0].funciones.map((f) => f.funcion_id)).toEqual([3, 1]); // sorted by time
});

test("groupByDate groups and sorts times within a date", () => {
  const fns = [
    mk({ funcion_id: 1, funcion_fecha: "2026-08-23", funcion_hora_inicio: "1970-01-01T21:00:00.000Z" }),
    mk({ funcion_id: 2, funcion_fecha: "2026-08-23", funcion_hora_inicio: "1970-01-01T15:00:00.000Z" }),
    mk({ funcion_id: 3, funcion_fecha: "2026-08-24", funcion_hora_inicio: "1970-01-01T18:00:00.000Z" }),
  ];
  const g = groupByDate(fns);
  expect(g.map((d) => d.fecha)).toEqual(["2026-08-23", "2026-08-24"]);
  expect(g[0].funciones.map((f) => f.funcion_id)).toEqual([2, 1]); // 15:00 before 21:00
});

const cells = [
  { silla_id: 91, mapa_sala_numero_silla: "F17", silla_disponible: true },
  { silla_id: 92, mapa_sala_numero_silla: "F16", silla_disponible: true },
  { silla_id: 5, mapa_sala_numero_silla: "A13", silla_disponible: false },
];

test("resolveSeats accepts labels and ids, dedupes, reports problems", () => {
  const ok = resolveSeats(["F17", "92"], cells);
  expect(ok.problems).toEqual([]);
  expect(ok.seats).toEqual([
    { id: 91, numero: "F17" },
    { id: 92, numero: "F16" },
  ]);

  const bad = resolveSeats(["A13", "Z99"], cells);
  expect(bad.seats).toEqual([]);
  expect(bad.problems.length).toBe(2); // taken + nonexistent

  const dupe = resolveSeats(["F17", "91"], cells);
  expect(dupe.seats).toEqual([{ id: 91, numero: "F17" }]);
});
