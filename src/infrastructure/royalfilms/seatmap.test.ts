import { test, expect } from "bun:test";
import { summarize, seatPrice, seatNumber, paintSeatMap, type SeatMap } from "./seatmap.ts";

const fixture: SeatMap = {
  configuracion_general: { cantidad_max_sillas: 10, duracion_tiempo_transaccion: 8 },
  sala_info: { sala_filas: 2, sala_columnas: 3 },
  mapa_sala: [
    {
      silla_id: 1,
      mapa_sala_coordenada_x: 0,
      mapa_sala_coordenada_y: 0,
      mapa_sala_estado_silla: 1,
      mapa_sala_tipo_silla: 57,
      mapa_sala_numero_silla: "A1",
      silla_disponible: true,
      silla_precio: [{ precio_taquilla_silla: { tipo_silla_precio: 17000 } }],
    },
    {
      silla_id: 2,
      mapa_sala_coordenada_x: 0,
      mapa_sala_coordenada_y: 1,
      mapa_sala_estado_silla: 2,
      mapa_sala_tipo_silla: 1056,
      mapa_sala_numero_silla: "A2",
      silla_disponible: false,
      silla_precio: [{ precio_taquilla_silla: { tipo_silla_precio: 25000 } }],
    },
  ],
};

test("summarize counts seats, availability, and price range", () => {
  const s = summarize(fixture);
  expect(s.filas).toBe(2);
  expect(s.columnas).toBe(3);
  expect(s.total).toBe(2);
  expect(s.disponibles).toBe(1);
  expect(s.ocupadas).toBe(1);
  expect(s.maxPorCompra).toBe(10);
  expect(s.precioMin).toBe(17000);
  expect(s.precioMax).toBe(25000);
});

test("seatPrice reads the nested price", () => {
  expect(seatPrice(fixture.mapa_sala[0])).toBe(17000);
});

test("seatNumber extracts the zero-padded numeric label", () => {
  expect(seatNumber(fixture.mapa_sala[0])).toBe("01"); // "A1" -> "01"
  expect(seatNumber({ ...fixture.mapa_sala[0], mapa_sala_numero_silla: "F17" })).toBe("17");
});

test("summarize groups price tiers by type with names", () => {
  const names = new Map([
    [57, "Standard"],
    [1056, "Discapacitados"],
  ]);
  const s = summarize(fixture, names);
  expect(s.tiers.length).toBe(2);
  const std = s.tiers.find((t) => t.tipo_silla_id === 57)!;
  expect(std.nombre).toBe("Standard");
  expect(std.precio).toBe(17000);
  expect(std.disponibles).toBe(1);
});

test("paintSeatMap does not throw on a valid map", () => {
  const orig = process.stdout.write;
  // swallow output
  // @ts-expect-error test stub
  process.stdout.write = () => true;
  try {
    expect(() => paintSeatMap(fixture, new Set([1]))).not.toThrow();
  } finally {
    process.stdout.write = orig;
  }
});
