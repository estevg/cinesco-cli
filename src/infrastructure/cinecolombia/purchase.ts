// Cine Colombia PurchasePort — browser-assisted (Cloudflare + reCAPTCHA). login opens
// a browser for the member to sign in; reserve drives that same browser to create the
// order and returns the PlacetoPay link. Prices are per seat (a default price).
// Progress goes to stderr (agent-first: diagnostics off stdout).
import type { PurchasePort, ReserveInput, PayInput } from "../../domain/ports.ts";
import type { Session, Showtime, SeatMap, Seat, Fare, Order, PaymentLink, PaymentMethod, Member } from "../../domain/entities.ts";
import { AuthError, DomainError } from "../../domain/errors.ts";
import { acquireSession, loadSession, checkoutViaBrowser, type Session as CcSession } from "./cinecolombia-token.ts";
import { whoami, showtimeSeats } from "./cinecolombia.ts";

const log = (m: string) => process.stderr.write(m + "\n");

export const cinecolombiaPurchase: PurchasePort = {
  async login(): Promise<Session> {
    // Ignores email/password: Cine Colombia logs in through the browser.
    let cc = loadSession();
    if (!cc || cc.expired || !cc.memberCookie) {
      try {
        await acquireSession(true, log);
        cc = loadSession();
      } catch (e) {
        throw new AuthError((e as Error).message);
      }
    }
    if (!cc?.memberCookie) throw new AuthError("no quedó sesión de socio");
    let member: Member = {};
    try {
      const w = await whoami();
      member = { id: w.id ?? "", name: w.name, email: w.email };
    } catch {
      /* profile is a nicety */
    }
    return { provider: "cinecolombia", member, credentials: { cc: cc as CcSession } };
  },

  async getSeatMap(st: Showtime): Promise<SeatMap> {
    const info = await showtimeSeats(st.id);
    const priceCents = info.precioDefault != null ? Math.round(info.precioDefault * 100) : undefined;
    const order: number[] = [];
    const byRow = new Map<number, { name: string; seats: Seat[] }>();
    let columns = 0;
    for (const s of info.seats) {
      columns = Math.max(columns, s.col);
      if (!byRow.has(s.row)) {
        byRow.set(s.row, { name: s.rowLabel, seats: [] });
        order.push(s.row);
      }
      byRow.get(s.row)!.seats.push({
        id: s.seatId, label: `${s.rowLabel}${s.number}`, row: s.rowLabel, column: s.col,
        available: s.status === "Available", category: s.areaName, priceCents,
      });
    }
    const rows = order.sort((a, b) => a - b).map((r) => byRow.get(r)!);
    return { cinemaId: st.cinemaId, showtimeId: st.id, columns, rows };
  },

  async listFares(): Promise<Fare[]> {
    return []; // per-seat default price
  },

  paymentMethods: (): PaymentMethod[] => [],

  async reserve(input: ReserveInput): Promise<Order> {
    const { showtime: st, seats } = input;
    const co = await checkoutViaBrowser(st.cinemaId, st.id, seats.map((s) => s.id), log);
    if (!co.paymentUrl) throw new DomainError("no se generó el link de pago", "not-available");
    return { id: co.orderId, total: Math.round(co.total ?? 0), seatLabels: seats.map((s) => s.label), meta: { paymentUrl: co.paymentUrl } };
  },

  async pay(input: PayInput): Promise<PaymentLink> {
    const url = String(input.order.meta?.paymentUrl ?? "");
    if (!url) throw new DomainError("la orden no tiene link de pago", "not-available");
    return { provider: "cinecolombia", orderId: input.order.id, url, method: "PlacetoPay" };
  },
};
