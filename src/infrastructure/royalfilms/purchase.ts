// Royal Films PurchasePort — wraps the bespoke JWT flow (reserve → sale → ePayco).
// Prices are per-seat (Seat.priceCents), so no Fare is chosen. `pay` writes the ePayco
// opener HTML and returns its path as the link (the human pays in the browser).
import type { PurchasePort, ReserveInput, PayInput } from "../../domain/ports.ts";
import type { Session, Showtime, SeatMap, Seat, Fare, Order, PaymentLink, PaymentMethod, Member } from "../../domain/entities.ts";
import { AuthError, DomainError } from "../../domain/errors.ts";
import { apiGet } from "./api.ts";
import { login as rfLogin } from "./auth.ts";
import { decodeJwt, type Session as RfSession } from "./session.ts";
import { buildReserveBody, reserve as rfReserve, type ReserveResult } from "./reserve.ts";
import { createSale } from "./sale.ts";
import { buildSessionData, getSessionId, buildCheckoutHtml, billingFromToken } from "./checkout.ts";
import { seatPrice, type SeatMap as RfSeatMap, type SeatCell } from "./seatmap.ts";
import type { FunctionCell } from "./wizard.ts";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Row = Record<string, any>;
interface Cred { token: string; rfSession: RfSession }
const cred = (s: Session): Cred => s.credentials as unknown as Cred;

async function rawSeatMap(hall: string, showtimeId: string, userId: number, token: string): Promise<RfSeatMap> {
  return apiGet<RfSeatMap>(`/cinemas/halls/id/${hall}/function/id/${showtimeId}/channel/id/1/user/id/${userId}`, token);
}
async function typeNames(token: string): Promise<Map<number, string>> {
  try {
    const t = await apiGet<Row[]>(`/cinemas/halls/chairTypes`, token);
    return new Map(t.map((x) => [Number(x.tipo_silla_id), String(x.tipo_silla_nombre)]));
  } catch {
    return new Map();
  }
}
async function functionCell(movieId: string, cityId: string, showtimeId: string, token: string): Promise<FunctionCell> {
  const fns = await apiGet<FunctionCell[]>(`/movies/functions/${movieId}/city/${cityId}`, token);
  const fn = fns.find((f) => String(f.funcion_id) === String(showtimeId));
  if (!fn) throw new DomainError("no encontré la función", "not-available");
  return fn;
}

export const royalfilmsPurchase: PurchasePort = {
  async login({ email, password }): Promise<Session> {
    let rf: RfSession;
    try {
      rf = await rfLogin(email, password);
    } catch (e) {
      throw new AuthError((e as Error).message);
    }
    const u = (decodeJwt(rf.token).user ?? {}) as Row;
    const member: Member = {
      id: String(rf.user.id),
      name: [u.usuario_cliente_nombres, u.usuario_cliente_apellidos].filter(Boolean).join(" ") || rf.user.nombres,
      email: rf.user.correo,
      documentId: u.usuario_cliente_documento ? String(u.usuario_cliente_documento) : undefined,
    };
    return { provider: "royalfilms", member, credentials: { token: rf.token, rfSession: rf } };
  },

  async getSeatMap(st: Showtime, session: Session): Promise<SeatMap> {
    const { token, rfSession } = cred(session);
    const map = await rawSeatMap(st.hall ?? "", st.id, rfSession.user.id, token);
    const cols = map.sala_info.sala_columnas;
    const rowsByX = new Map<number, { name: string; seats: Seat[] }>();
    for (const cell of map.mapa_sala) {
      const x = cell.mapa_sala_coordenada_x;
      const rowName = cell.mapa_sala_numero_silla.match(/^[A-Za-z]+/)?.[0] ?? "?";
      if (!rowsByX.has(x)) rowsByX.set(x, { name: rowName, seats: [] });
      rowsByX.get(x)!.seats.push({
        id: String(cell.silla_id), label: cell.mapa_sala_numero_silla, row: rowName,
        column: cell.mapa_sala_coordenada_y + 1, available: cell.silla_disponible,
        special: cell.mapa_sala_estado_silla !== 1, priceCents: (seatPrice(cell) ?? 0) * 100,
        meta: { tipo: cell.mapa_sala_tipo_silla },
      });
    }
    const rows = [...rowsByX.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
    return { cinemaId: st.cinemaId, showtimeId: st.id, columns: cols, rows };
  },

  async listFares(): Promise<Fare[]> {
    return []; // Royal Films prices per seat; no fare to choose
  },

  paymentMethods: (): PaymentMethod[] => [],

  async reserve(input: ReserveInput): Promise<Order> {
    const { session, showtime: st, movie, regionId, seats } = input;
    const { token, rfSession } = cred(session);
    const cityId = regionId!;
    const uid = rfSession.user.id;
    const [map, names, fn] = await Promise.all([
      rawSeatMap(st.hall ?? "", st.id, uid, token),
      typeNames(token),
      functionCell(movie.id, cityId, st.id, token),
    ]);
    const byId = new Map<number, SeatCell>(map.mapa_sala.map((c) => [c.silla_id, c]));
    const chosen = seats.map((s) => ({ id: Number(s.id), numero: s.label }));
    const total = chosen.reduce((sum, c) => sum + (seatPrice(byId.get(c.id)!) ?? 0), 0);

    const body = buildReserveBody(fn.funcion_id, fn.funcion_multicine_id, fn.funcion_sala_id, chosen);
    const res: ReserveResult = await rfReserve(body, token);
    const r = res.reserve;
    const sale = await createSale({
      token, session: rfSession, cityId: Number(cityId), multicineId: fn.funcion_multicine_id, movieId: Number(movie.id),
      fn, map, typeNames: names, chosen, total,
      reserve: { reserva_silla_id: r.reserva_silla_id, reserva_silla_funcion: r.reserva_silla_funcion, reserva_silla_multicine: r.reserva_silla_multicine, reserva_silla_sala: r.reserva_silla_sala, reserva_silla_total: total },
    });
    return { id: String(sale.venta_id), total, seatLabels: seats.map((s) => s.label), meta: { cityId, multicineId: fn.funcion_multicine_id } };
  },

  async pay(input: PayInput): Promise<PaymentLink> {
    const { session, order } = input;
    const { token } = cred(session);
    const cityId = String(order.meta?.cityId ?? "");
    const multicineId = Number(order.meta?.multicineId ?? 0);
    const cinemas = await apiGet<Row[]>(`/cinemas/city/${cityId}`, token);
    const c = cinemas.find((x) => Number(x.multicine_id) === multicineId);
    if (!c || c.CompanyInfo == null) throw new DomainError("no encontré el POS de ePayco de este cine", "not-available");
    const company = c.CompanyInfo as Row;
    const sessionData = buildSessionData({
      posEpayco: Number(company.empresa_pos_epayco), multicineCodigo: Number(c.multicine_codigo),
      amount: order.total, billing: billingFromToken(token), invoiceRef: order.id,
    });
    const sessionId = await getSessionId(sessionData, token);
    const htmlPath = join(homedir(), ".royalfilms", `pago-${order.id}.html`);
    writeFileSync(htmlPath, buildCheckoutHtml(sessionId, "$" + order.total.toLocaleString("es-CO")), { mode: 0o600 });
    return { provider: "royalfilms", orderId: order.id, url: htmlPath, method: "ePayco" };
  },
};

