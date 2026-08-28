import { test, expect } from "bun:test";
import { buildReserveBody } from "./reserve.ts";

test("buildReserveBody joins seat ids and labels, matching the observed body", () => {
  const body = buildReserveBody(885112, 2022, 2056, [
    { id: 1, numero: "A17" },
    { id: 2, numero: "A16" },
  ]);
  expect(body).toEqual({
    reserva_silla_funcion: 885112,
    reserva_silla_multicine: 2022,
    reserva_silla_sala: 2056,
    sillas_reservadas_id: "1,2",
    sillas_reservadas_numero: "A17,A16",
    auto_assign_by_type: false,
    chair_type_quantities: [],
  });
});
