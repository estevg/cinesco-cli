// Cinemark PurchasePort — 100% headless. login → seatMap → fares → reserve
// (orders/tickets + orders + orders/continue) → pay (payments/pay-order + poll
// orders/status → PSE link). Auth = connectapitoken + the x-fingerprint-id device
// JWT from the login response header.
import { sleep } from "../../shared/proc.ts";
import type { PurchasePort, ReserveInput, PayInput } from "../../domain/ports.ts";
import type { Session, Showtime, SeatMap, Seat, Fare, Order, PaymentLink, PaymentMethod, Member } from "../../domain/entities.ts";
import { AuthError, PendingOrderError, NotAvailableError } from "../../domain/errors.ts";
import { coreGet, wwwGet, wwwPost, corePost, vista, ordersApi, CO, loyaltyLogin, encryptPaymentInfo } from "./client.ts";

type Row = Record<string, any>;
interface Cred { token: string; fingerprint: string; userSessionId: string }
const cred = (s: Session): Cred => s.credentials as unknown as Cred;

const PLATFORM = { AppName: "Cinemark Colombia", Os: "Web application", Version: "0.1.0", ClientId: CO.clientId, CompanyId: CO.companyId };
const MEMBER_TIER = /(pro|gold|club|member|socio|mensual|gratis|pase|promo|dbox|premier|amex|2x1)/i;

// --- PSE banks (FINANCIAL_INSTITUTION_CODE) --------------------------------------
const PSE_BANKS: PaymentMethod[] = [
  { code: "1007", name: "BANCOLOMBIA" }, { code: "1001", name: "BANCO DE BOGOTA" },
  { code: "1051", name: "DAVIVIENDA" }, { code: "1013", name: "BBVA COLOMBIA" },
  { code: "1023", name: "BANCO DE OCCIDENTE" }, { code: "1062", name: "BANCO FALABELLA" },
  { code: "1507", name: "NEQUI" }, { code: "1551", name: "DAVIPLATA" },
];

// --- helpers ---------------------------------------------------------------------
function jwtExp(token: string): number {
  try { return Number(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp) || 0; } catch { return 0; }
}
function newUserSessionId(): string {
  return [...crypto.getRandomValues(new Uint8Array(14))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function rand32hex(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function publicIp(): Promise<string> {
  try { return (await (await fetch("https://api.ipify.org?format=json")).json()).ip as string; } catch { return "0.0.0.0"; }
}
function findGatewayUrl(v: unknown): string | undefined {
  if (typeof v === "string") return /^https?:\/\/\S*(pse\.com|boton|payu|placetopay|gateway)/i.test(v) ? v : undefined;
  if (v && typeof v === "object") for (const x of Object.values(v as Row)) { const f = findGatewayUrl(x); if (f) return f; }
  return undefined;
}
const MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function payDescription(o: Row): string {
  const [y, m, d] = String(o.date).split("-").map(Number);
  const [hh, mm] = String(o.time).split(":").map(Number);
  const dt24 = `${MONTHS_ES[m - 1]} ${d} ${y} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const ap = hh < 12 ? "AM" : "PM";
  const dt12 = `${String(((hh + 11) % 12) + 1).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${ap}`;
  return [o.cinemaName, o.cinemaId, dt24, o.movieTitle, o.corporateFilmId, dt12, o.seatLabels, o.totalPesos, o.fullName, o.email, o.documentId, "Plat:web", "Versión 0.1.0"].join("_");
}

// Build the Movie block orders/tickets requires (backend validates address/rating/city).
async function movieBlock(fp: string, regionId: string, cinemaId: string, movieId: string) {
  const cities = await coreGet<any[]>(vista(`/cities-theaters?$format=json&$select=ID,Name,Address1,Address2,City`), fp);
  let name = "", address = "", city = "";
  for (const c of cities) for (const t of (c.Theaters ?? []) as Row[]) {
    if (String(t.CinemaId ?? t.ID) === String(cinemaId)) { name = String(t.Name ?? ""); address = String(t.Address1 ?? ""); city = String(t.City ?? c.Name ?? ""); }
  }
  let rating = "";
  try {
    const bb = await coreGet<Row>(vista(`/city/${regionId}/movies-billboard-city?companyId=${CO.companyId}`), fp);
    const m = [...(bb.PremieresBillboard ?? []), ...(bb.Presales ?? [])].find((x: Row) => String(x.CorporateFilmId) === String(movieId));
    rating = String(m?.RatingAlt || m?.Rating || "");
  } catch { /* best effort */ }
  return { CinemaName: name, CinemaAddress: address, Rating: rating, RatingDescription: rating, CorporateFilmId: movieId, CinemaCity: city };
}

// --- the port --------------------------------------------------------------------
export const cinemarkPurchase: PurchasePort = {
  async login({ email, password }): Promise<Session> {
    const usid = newUserSessionId();
    const { data: res, headers } = await loyaltyLogin({ UserSessionId: usid, ReturnMember: true, MemberLogin: email, MemberPassword: password });
    if (res?.Result !== 0 || !res?.LoyaltySessionToken) throw new AuthError(res?.ErrorDescription || "login rechazado (revisá email/contraseña)");
    const fingerprint = headers.get("x-fingerprint-id") || "";
    if (!fingerprint) throw new AuthError("el login no devolvió el fingerprint");
    const m = (res.LoyaltyMember ?? res.Member ?? {}) as Row;
    const member: Member = {
      id: String(m.MemberId ?? m.LoyaltyMemberId ?? ""),
      name: m.FullName ? String(m.FullName) : [m.FirstName, m.LastName].filter(Boolean).join(" ") || undefined,
      email: m.Email ? String(m.Email) : email,
      phone: m.MobilePhone ? String(m.MobilePhone) : m.HomePhone ? String(m.HomePhone) : undefined,
      documentId: m.NationalID ? String(m.NationalID) : undefined,
    };
    void jwtExp; // token TTL ~5min; a fresh login runs per purchase
    return { provider: "cinemark", member, credentials: { token: res.LoyaltySessionToken, fingerprint, userSessionId: usid } };
  },

  async getSeatMap(st: Showtime, _session?: Session): Promise<SeatMap> {
    const d = await coreGet<any>(vista(`/cinemas/${st.cinemaId}/sessions/${st.id}/seat-plan`));
    const sl = d?.SeatLayoutData ?? {};
    const categories = ((sl.AreaCategories ?? []) as Row[]).map((c) => ({ code: String(c.AreaCategoryCode), name: String(c.Name) }));
    const std = mostCommonCategory(sl);
    const rows: SeatMap["rows"] = [];
    let columns = 0;
    for (const a of (sl.Areas ?? []) as Row[]) {
      const areaCat = String(a.AreaCategoryCode ?? "");
      for (const r of (a.Rows ?? []) as Row[]) {
        const name = String(r.PhysicalName ?? "");
        const seats: Seat[] = [];
        for (const s of (r.Seats ?? []) as Row[]) {
          const col = Number(s.Position?.ColumnIndex ?? 0);
          columns = Math.max(columns, col);
          seats.push({
            id: String(s.Id), label: `${name}${s.Id}`, row: name, column: col,
            available: Number(s.Status) === 0, category: areaCat, special: areaCat !== std,
            meta: { rowIndex: Number(s.Position?.RowIndex ?? 0), areaNumber: Number(s.Position?.AreaNumber ?? a.Number ?? 1), areaCategoryCode: areaCat },
          });
        }
        if (seats.length) rows.push({ name, seats });
      }
    }
    return { cinemaId: st.cinemaId, showtimeId: st.id, columns, rows, categories };
  },

  async listFares(st: Showtime, session: Session): Promise<Fare[]> {
    const { fingerprint, userSessionId } = cred(session);
    const d = await coreGet<any>(
      vista(`/cinemas/${st.cinemaId}/sessions/${st.id}/tickets?$format=json&salesChannelFilter=SUNDW&userSessionId=${userSessionId}&companyId=${CO.companyId}`),
      fingerprint,
    );
    return ((d?.Tickets ?? (Array.isArray(d) ? d : [])) as Row[])
      .filter((t) => !t.IsRedemptionTicket && Number(t.PriceInCents) > 0 && !MEMBER_TIER.test(String(t.DescriptionAlt || t.Description || "")))
      .map((t) => ({ code: String(t.TicketTypeCode), name: String(t.DescriptionAlt || t.Description || t.TicketTypeCode).trim(), priceCents: Number(t.PriceInCents ?? 0), category: String(t.AreaCategoryCode ?? "") }));
  },

  paymentMethods: () => PSE_BANKS,

  async reserve(input: ReserveInput): Promise<Order> {
    const { session, showtime: st, movie, regionId, seats, fare } = input;
    const { fingerprint, userSessionId } = cred(session);
    const m = session.member!;
    const movieBlk = await movieBlock(fingerprint, regionId ?? "", st.cinemaId, movie.id);
    const body = {
      BookingMode: 0, OptionalClientId: CO.optionalClientId, ProcessOrderValue: true, ReturnOrder: true,
      ReturnSeatData: true, SkipAutoAllocation: false, UserSelectedSeatingSupported: false,
      SelectedSeats: seats.map((s) => ({ AreaCategoryCode: (s.meta as Row).areaCategoryCode, AreaNumber: (s.meta as Row).areaNumber, RowIndex: (s.meta as Row).rowIndex, ColumnIndex: s.column })),
      OptionalClientClass: "WWW", Platform: PLATFORM, SessionId: Number(st.id), CinemaId: Number(st.cinemaId), UserSessionId: userSessionId,
      Movie: movieBlk, TicketTypes: [{ TicketTypeCode: fare.code, Qty: seats.length }], PromotionalCampaigns: [],
      User: { FullName: m.name ?? "", Email: m.email ?? "", Phone: m.phone ?? "", MemberId: m.id, DocumentId: m.documentId ?? "", CustomerType: 2 },
      CalculateGoldDiscount: true, CalculateProDiscount: false,
    };
    const res = await wwwPost<any>(ordersApi(`/orders/tickets`), body, fingerprint);
    const order = res?.Order;
    const orderId = order?.InternalOrderId as string | undefined;
    if (!orderId) throw new PendingOrderError();
    await wwwPost<any>(ordersApi(`/orders`), { UserSessionId: userSessionId, ProcessOrderValue: true, BookingMode: 0, OptionalClientId: CO.optionalClientId }, fingerprint);
    await corePost<any>(vista(`/orders/continue`), { UserSessionId: userSessionId, OptionalClientId: CO.optionalClientId }, fingerprint);
    return { id: orderId, total: Math.round(Number(order.TotalValueCents ?? 0) / 100), seatLabels: seats.map((s) => s.label), meta: { cinemaName: movieBlk.CinemaName } };
  },

  async pay(input: PayInput): Promise<PaymentLink> {
    const { session, order, showtime: st, movie, seats, method } = input;
    const { fingerprint, userSessionId } = cred(session);
    const m = session.member!;
    const bank = method ?? PSE_BANKS[0];
    const ip = await publicIp();
    const [paymentInfo, deviceSessionId] = [await encryptPaymentInfo(fingerprint), rand32hex()];
    const doc = m.documentId ?? "";
    const body = {
      gateway: { name: "payu", command: "SUBMIT_TRANSACTION", country: "CO", client: "web", contentClientId: CO.clientId },
      payload: {
        order: {
          description: payDescription({ cinemaName: order.meta?.cinemaName ?? st.cinemaName, cinemaId: st.cinemaId, date: st.date, time: st.time ?? "00:00", movieTitle: movie.title, corporateFilmId: movie.id, seatLabels: seats.map((s) => s.label).join(","), totalPesos: order.total, fullName: m.name ?? "", email: m.email ?? "", documentId: doc }),
          additionalValues: { TX_VALUE: { value: order.total, currency: "COP" }, TX_TAX: { value: 0, currency: "COP" }, TX_TAX_RETURN_BASE: { value: 0, currency: "COP" } },
          buyer: { emailAddress: m.email ?? "" },
        },
        payer: { dniNumber: doc, dniType: "CC", fullName: m.name ?? "", emailAddress: m.email ?? "", contactPhone: m.phone ?? "", merchantPayerId: m.id },
        type: "AUTHORIZATION_AND_CAPTURE", deviceSessionId, ipAddress: ip, cookie: userSessionId,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152 Safari/537.36",
        paymentCountry: "CO", memberLevelId: 6,
        extraParameters: { RESPONSE_URL: `https://www.cinemark.com.co/compras/${st.cinemaId}/${st.id}`, PSE_REFERENCE1: ip, PSE_REFERENCE3: doc, USER_TYPE: "N", PSE_REFERENCE2: "CC", FINANCIAL_INSTITUTION_CODE: bank.code },
        paymentMethod: "PSE",
      },
      vista: {
        body: {
          BookingMode: 0, CustomerType: 2, GenerateConcessionVoucherPrintStream: false, OptionalClientClass: "WWW", OptionalClientId: CO.optionalClientId,
          OptionalReturnMemberBalances: false, PassTypesRequestedForOrder: { IncludeApplePassBook: true, IncludeICal: true },
          PaymentInfo: paymentInfo, PerformPayment: false, PrintStreamType: 0, UseAlternateLanguage: false, UserSessionId: userSessionId, InternalOrderId: order.id,
        },
      },
    };
    await wwwPost<any>(`/api/payments/country/co/pay-order`, body, fingerprint);
    // poll the gateway URL
    for (let i = 0; i < 20; i++) {
      const d = await wwwGet<any>(`/api/orders/status/${order.id}`, fingerprint);
      const url = findGatewayUrl(d);
      if (url) return { provider: "cinemark", orderId: order.id, url, method: bank.name };
      await sleep(1500);
    }
    throw new NotAvailableError("no obtuve el link de pago a tiempo");
  },
};

function mostCommonCategory(sl: Row): string {
  const count = new Map<string, number>();
  for (const a of (sl.Areas ?? []) as Row[]) for (const r of (a.Rows ?? []) as Row[]) for (const s of (r.Seats ?? []) as Row[]) {
    const c = String(a.AreaCategoryCode ?? "");
    count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}
