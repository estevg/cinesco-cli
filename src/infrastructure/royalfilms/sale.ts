import { apiGet, apiPost } from "./api.ts";
import { decodeJwt, type Session } from "./session.ts";
import type { SeatMap, SeatCell } from "./seatmap.ts";
import type { FunctionCell } from "./wizard.ts";

// Build and create the Royal Films sale (venta), the step that turns a reservation into a
// payable order. Mapped from a real web capture: POST /sale creates a pending
// (venta_estado_epayco "EN PROCESO") venta and returns its venta_id, which the ePayco
// session then references. Creating it does NOT charge — the charge happens in ePayco.
type Row = Record<string, unknown>;

interface SelectedItem {
  id: number;
  type: number;
  type_name: string;
  price: number;
  discountPrice: number | null;
  number: string;
  display_number: string;
  is_free_seating: boolean;
  price_id: number;
  price_name: string;
}

export interface ReserveInfo {
  reserva_silla_id: number;
  reserva_silla_funcion: number;
  reserva_silla_multicine: number;
  reserva_silla_sala: number;
  reserva_silla_total: number;
}

function guestJson(session: Session, token: string): string {
  const u = (decodeJwt(token).user ?? {}) as Row;
  return JSON.stringify({
    usuario_nombre: u.usuario_cliente_nombres ?? session.user.nombres ?? "",
    usuario_apellido: u.usuario_cliente_apellidos ?? session.user.apellidos ?? "",
    usuario_documento: String(u.usuario_cliente_documento ?? ""),
    usuario_correo: u.usuario_cliente_correo ?? session.user.correo ?? "",
    usuario_direccion: u.usuario_cliente_direccion ?? "",
    usuario_telefono: String(u.usuario_cliente_telefono ?? ""),
    usuario_tipo_documento: u.usuario_cliente_tipo_documento ?? 2,
  });
}

function selectedItems(
  chosen: { id: number; numero: string }[],
  map: SeatMap,
  typeNames: Map<number, string>,
): SelectedItem[] {
  const byId = new Map<number, SeatCell>(map.mapa_sala.map((c) => [c.silla_id, c]));
  return chosen.map((s) => {
    const cell = byId.get(s.id)!;
    const pr = cell.silla_precio?.[0];
    const price = pr?.precio_taquilla_silla?.tipo_silla_precio ?? 0;
    const type = cell.mapa_sala_tipo_silla;
    const typeName = typeNames.get(type) ?? "Standard";
    return {
      id: s.id,
      type,
      type_name: typeName,
      price,
      discountPrice: null,
      number: cell.mapa_sala_numero_silla,
      display_number: cell.mapa_sala_numero_silla,
      is_free_seating: false,
      price_id: Number((pr as Row)?.tipo_silla_precio_detalle_id ?? 0),
      price_name: typeName,
    };
  });
}

// Fetch the movie detail block the sale expects under boxOffice.movie.
async function movieBlock(movieId: number, cityId: number, token: string): Promise<Row> {
  let m: Row = {};
  try {
    const d = await apiGet<Row>(`/movies/id/${movieId}/city/${cityId}`, token);
    m = ((d?.pelicula as Row) ?? d) as Row;
  } catch {
    /* best effort */
  }
  return {
    pelicula_poster_s3: m.pelicula_poster_s3 ?? null,
    pelicula_titulo: m.pelicula_titulo ?? m.pelicula_nombre_formato ?? "",
    pelicula_duracion: m.duracion ?? m.pelicula_duracion ?? 0,
    pelicula_preventa: m.pelicula_preventa ?? 0,
    pelicula_prestreno: m.pelicula_prestreno ?? 0,
    pelicula_estreno: m.pelicula_estreno ?? 0,
    pelicula_bloqueo_compra_bono: m.pelicula_bloqueo_compra_bono ?? 0,
    pelicula_bloqueo_compra_boleteria_emergencia: m.pelicula_bloqueo_compra_boleteria_emergencia ?? 0,
  };
}

export async function createSale(opts: {
  token: string;
  session: Session;
  cityId: number;
  multicineId: number;
  movieId: number;
  fn: FunctionCell;
  map: SeatMap;
  typeNames: Map<number, string>;
  chosen: { id: number; numero: string }[];
  reserve: ReserveInfo;
  total: number;
}): Promise<{ venta_id: number }> {
  const { token, session, cityId, multicineId, movieId, fn, map, typeNames, chosen, reserve, total } = opts;
  const items = selectedItems(chosen, map, typeNames);
  const boxOffice = {
    movie: await movieBlock(movieId, cityId, token),
    function: {
      formato_nombre: fn.formato?.formato_nombre ?? "",
      version: fn.version?.version_nombre ?? "",
      funcion_fecha: fn.funcion_fecha,
      funcion_hora_inicio: fn.funcion_hora_inicio,
      funcion_sala: fn.sala?.sala_nombre ?? "",
      multicine_nombre: fn.multicine?.multicine_nombre ?? "",
    },
    reserva_silla_id: reserve.reserva_silla_id,
    reserva_silla_funcion: reserve.reserva_silla_funcion,
    reserva_silla_multicine: reserve.reserva_silla_multicine,
    reserva_silla_sala: reserve.reserva_silla_sala,
    reserva_silla_total: reserve.reserva_silla_total,
    pelicula_id: movieId,
    selectedItems: items,
  };
  const body = {
    venta_usuario_id: session.user.id,
    venta_membresia: null,
    venta_ciudad: cityId,
    venta_observaciones: "Venta en pagina web",
    venta_total: total,
    venta_canal_venta: 5,
    venta_terminal: null,
    venta_usuario_terminal: null,
    venta_multicine: multicineId,
    // The web sends JSON.stringify(coupon); with no coupon that's the string "null".
    venta_metodo_pago: "null",
    venta_usuario_documento: String((decodeJwt(token).user as Row)?.usuario_cliente_documento ?? ""),
    venta_usuario_invitado: guestJson(session, token),
    venta_comentarios: "",
    boxOffice,
    candyStand: null,
    supplementary: { products: [] },
    coupon: null,
    promotion: null,
    firstTime: null,
    birthDay: null,
    codes_ids: [],
  };
  const res = await apiPost<Row>(`/sale`, body, token);
  const ventaId = Number((res?.venta as Row)?.venta_id ?? res?.venta_id);
  if (!ventaId) throw new Error("la venta no devolvió venta_id");
  return { venta_id: ventaId };
}
