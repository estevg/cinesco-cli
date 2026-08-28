// Cine Colombia adapter — Vista OCAPI.
//
// Auth (verified): app Bearer token (SSR-embedded "authToken") + member cookie
// `vista-loyalty-member-authentication-token` (set after browser login). Both are
// captured by `cinesco cinecolombia login`; browse needs only the app token.
import type { Provider, Cinema, Movie, Showtime } from "./types.ts";
import { loadSession } from "./cinecolombia-token.ts";
import { style } from "../../shared/output.ts";

const BASE = "https://digital-api.cinecolombia.com/ocapi/v1";
const UA = "cinesco-cli/0.1.0";

function authHeaders(memberRequired = false): Record<string, string> {
  const s = loadSession();
  if (!s || !s.appToken) {
    throw new Error(
      "falta la sesión de Cine Colombia. Corré: cinesco cinecolombia token (navegar) o login (miembro).",
    );
  }
  if (s.expired) throw new Error("la sesión de Cine Colombia expiró. Volvé a correr 'cinesco cinecolombia token' o 'login'.");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": UA,
    Authorization: `Bearer ${s.appToken}`,
  };
  if (s.memberCookie) headers.Cookie = `vista-loyalty-member-authentication-token=${s.memberCookie}`;
  else if (memberRequired) throw new Error("esto necesita sesión de miembro. Corré: cinesco cinecolombia login");
  return headers;
}

async function get<T>(path: string, memberRequired = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders(memberRequired) });
  if (res.status === 401) throw new Error("sesión inválida o expirada (401). Corré 'cinesco cinecolombia login'.");
  return (await res.json()) as T;
}

// NOTE: Cine Colombia WRITES (order create, seat select, cancel) do NOT run here.
// Cloudflare fingerprints the TLS client (JA3) on writes, so a headless fetch with valid
// cookies still gets 403. The write path executes inside the real browser — see
// reserveViaBrowser / cancelViaBrowser in cinecolombia-token.ts. Reads below are headless.

interface OcapiName {
  text: string;
}

// Fetch cinemas (sites) with their city, filtering out non-cinema entries (RECARGAS).
// City comes from contactDetails.address.city ("Cali, Valle del Cauca" -> "Cali").
async function ccSites(): Promise<Cinema[]> {
  const data = await get<{
    sites: { id: string; name: OcapiName; contactDetails?: { address?: { city?: string } } }[];
  }>(`/sites`);
  return (data.sites ?? [])
    .filter((s) => !/RECARGA/i.test(s.name?.text ?? ""))
    .map((s) => ({
      id: String(s.id),
      name: s.name?.text ?? String(s.id),
      region: (s.contactDetails?.address?.city ?? "").split(",")[0].trim() || undefined,
    }));
}

export const cinecolombia: Provider = {
  id: "cinecolombia",
  name: "Cine Colombia",
  country: "Colombia",
  auth: "browser-assisted",
  notes:
    "Vista OCAPI. Navegar necesita el token de app; login/compra son browser-assisted (Cloudflare + reCAPTCHA). El pago se completa en el navegador.",
  capabilities: { browse: true, seatmap: true, reserve: true, checkout: true },

  async listRegions(): Promise<Cinema[]> {
    const cines = await ccSites();
    const cities = [...new Set(cines.map((c) => c.region).filter(Boolean))].sort();
    return cities.map((c) => ({ id: c!, name: c! }));
  },

  async listCinemas(region?: string): Promise<Cinema[]> {
    const cines = await ccSites();
    return region ? cines.filter((c) => c.region === region) : cines;
  },

  async listMovies(): Promise<Movie[]> {
    const data = await get<{ films: { id: string; title: OcapiName }[] }>(`/films`);
    return (data.films ?? []).map((f) => ({ id: String(f.id), title: f.title?.text ?? String(f.id) }));
  },

  async listShowtimes({ cinemaId, movieId }): Promise<Showtime[]> {
    if (!cinemaId) throw new Error("Cine Colombia necesita un cinemaId (siteId) para las funciones.");
    const data = await get<{
      businessDate: string;
      showtimes: {
        id: string;
        schedule?: { startsAt?: string; businessDate?: string };
        filmId?: string;
        siteId?: string;
        screenId?: string;
        seatLayoutId?: string;
      }[];
    }>(`/showtimes/by-business-date/first?siteIds=${cinemaId}`);
    return (data.showtimes ?? [])
      .filter((s) => !movieId || s.filmId === movieId)
      .map((s) => ({
        id: String(s.id),
        date: s.schedule?.businessDate ?? data.businessDate,
        time: s.schedule?.startsAt ? s.schedule.startsAt.slice(11, 16) : undefined,
        cinemaId,
        movieId: s.filmId,
        hall: s.seatLayoutId,
      }));
  },
};

// ---- Provider-specific extras (not on the shared Provider interface) ----

export async function whoami(): Promise<{ id?: string; email?: string; name?: string; club?: string }> {
  const d = await get<{
    member?: {
      id?: string;
      credentials?: { email?: string };
      personalDetails?: { name?: { givenName?: string; familyName?: string } };
    };
    relatedData?: { club?: { name?: OcapiName } };
  }>(`/members/current`, true);
  const m = d.member;
  const n = m?.personalDetails?.name;
  return {
    id: m?.id,
    email: m?.credentials?.email,
    name: n ? `${n.givenName ?? ""} ${n.familyName ?? ""}`.trim() : undefined,
    club: d.relatedData?.club?.name?.text,
  };
}

export interface SeatLayout {
  id: string;
  screenId: string;
  rows: { rowIndex?: number; seats: { id?: string; columnIndex?: number; status?: string }[] }[];
  raw: unknown;
}

// Static seat layout for a showtime's seatLayoutId (geometry).
export async function seatLayout(seatLayoutId: string): Promise<SeatLayout> {
  const d = await get<{ seatLayout?: { id: string; screenId: string; rows?: unknown[] } }>(
    `/seat-layouts/${seatLayoutId}`,
    true,
  );
  const sl = d.seatLayout;
  if (!sl) throw new Error("no se encontró el seat layout");
  return { id: sl.id, screenId: sl.screenId, rows: (sl.rows as SeatLayout["rows"]) ?? [], raw: sl };
}

// ---- Purchase flow (Vista OCAPI, mapped from a real capture) ----

export interface SeatAvailability {
  seatId: string; // "area_row_column", e.g. "1_3_25"
  status: string; // "Available" | ...
}
export interface Seat {
  seatId: string; // "area_row_column"
  area: number;
  areaName: string; // "GENERAL" | "PREFERENCIAL"
  row: number; // position row (1-based)
  col: number; // position column
  rowLabel: string; // "A".."M"
  number: string; // seat number as shown ("30")
  type: string; // Normal | Wheelchair | Companion | SofaLeft | SofaRight
  status: string; // Available | Sold | Broken | ...
}
export interface SeatInfo {
  total: number;
  available: Seat[];
  seats: Seat[];
  isSoldOut: boolean;
  precioDefault?: number;
  ticketTypeDefault?: string;
}

interface LayoutSeat {
  id: string;
  label?: string;
  rowLabel?: string;
  type?: string;
  position?: { areaNumber?: number; rowNumber?: number; columnNumber?: number };
  areaCategoryId?: string;
}
interface LayoutArea {
  number: number;
  name?: OcapiName;
  rows?: { number: number; label?: string; seats?: LayoutSeat[] }[];
}

export async function showtimeSeats(showtimeId: string): Promise<SeatInfo> {
  const [avail, prices, detail] = await Promise.all([
    get<{ seatAvailabilities: SeatAvailability[]; isSoldOut: boolean }>(`/showtimes/${showtimeId}/seat-availability`, true),
    get<{ ticketPrices: { isDefault: boolean; price: { valueIncludingTax: number } }[] }>(`/showtimes/${showtimeId}/ticket-prices`, true),
    get<{ showtime?: { seatLayoutId?: string } }>(`/showtimes/${showtimeId}`, true),
  ]);
  const status = new Map((avail.seatAvailabilities ?? []).map((s) => [s.seatId, s.status]));

  // Merge with the seat layout for row labels, seat numbers, category names and types.
  const seats: Seat[] = [];
  const layoutId = detail.showtime?.seatLayoutId;
  if (layoutId) {
    try {
      const lay = await get<{ seatLayout?: { areas?: LayoutArea[] } }>(`/seat-layouts/${layoutId}`, true);
      for (const area of lay.seatLayout?.areas ?? []) {
        const areaName = area.name?.text ?? `Zona ${area.number}`;
        for (const r of area.rows ?? []) {
          for (const s of r.seats ?? []) {
            if (!status.has(s.id)) continue; // only real (bookable) seats
            const [a, row, col] = s.id.split("_").map(Number);
            seats.push({
              seatId: s.id,
              area: a,
              areaName,
              row,
              col,
              rowLabel: s.rowLabel ?? r.label ?? String(row),
              number: s.label ?? String(col),
              type: s.type ?? "Normal",
              status: status.get(s.id) ?? "Unknown",
            });
          }
        }
      }
    } catch {
      /* fall through to the flat parse below */
    }
  }
  if (seats.length === 0) {
    for (const s of avail.seatAvailabilities ?? []) {
      const [a, row, col] = s.seatId.split("_").map(Number);
      seats.push({ seatId: s.seatId, area: a, areaName: `Zona ${a}`, row, col, rowLabel: String(row), number: String(col), type: "Normal", status: s.status });
    }
  }
  const def = prices.ticketPrices.find((p) => p.isDefault) ?? prices.ticketPrices[0];
  return {
    total: seats.length,
    available: seats.filter((s) => s.status === "Available"),
    seats,
    isSoldOut: avail.isSoldOut,
    precioDefault: def?.price?.valueIncludingTax,
  };
}

// Resolve user seat tokens: a seatId ("1_3_5"), or row+number ("H12", "H 12", "E01").
// The number is matched by value, so leading zeros ("E01") and bare ("E1") both work.
export function resolveSeats(tokens: string[], seats: Seat[]): { seatIds: string[]; problems: string[] } {
  const byId = new Map(seats.map((s) => [s.seatId, s]));
  // key = ROWLABEL + numeric value of the seat number
  const byRowNum = new Map(seats.map((s) => [`${s.rowLabel.toUpperCase()}${Number(s.number)}`, s]));
  const out: string[] = [];
  const problems: string[] = [];
  for (const raw of tokens) {
    const t = raw.trim();
    if (!t) continue;
    let s = byId.get(t);
    if (!s) {
      const m = t.toUpperCase().replace(/\s+/g, "").match(/^([A-Z]+)0*(\d+)$/);
      if (m) s = byRowNum.get(`${m[1]}${Number(m[2])}`);
    }
    if (!s) problems.push(`"${t}" no existe`);
    else if (s.status !== "Available") problems.push(`${s.rowLabel}${s.number} no está disponible`);
    else if (!out.includes(s.seatId)) out.push(s.seatId);
  }
  return { seatIds: out, problems };
}

// Paint the hall to stdout, one section per area (GENERAL / PREFERENCIAL). Rows use the
// real labels (A..M), cells show the seat number, aisles are gaps. Colors: green free
// (general), magenta free (preferencial), cyan wheelchair, red taken, cyan-bold chosen.
export function paintSeats(seats: Seat[], chosen: Set<string> = new Set()): void {
  const areas = [...new Set(seats.map((s) => s.area))].sort((a, b) => a - b);
  for (const area of areas) {
    const zone = seats.filter((s) => s.area === area);
    const areaName = zone[0]?.areaName ?? `Zona ${area}`;
    const pref = /prefer/i.test(areaName);
    // rows sorted by label (A..M); columns by position
    const rowLabels = [...new Set(zone.map((s) => s.rowLabel))].sort();
    const minCol = Math.min(...zone.map((s) => s.col));
    const maxCol = Math.max(...zone.map((s) => s.col));
    const width = (maxCol - minCol + 1) * 4;
    const label = `  PANTALLA  `;
    const pad = Math.max(2, Math.floor((width - label.length) / 2));
    process.stdout.write(
      "\n" + style.bold(pref ? style.magenta(areaName) : style.cyan(areaName)) + "\n" +
        "   " + style.dim("╭" + "─".repeat(pad) + label + "─".repeat(Math.max(2, width - pad - label.length)) + "╮") + "\n",
    );
    const byKey = new Map(zone.map((s) => [`${s.rowLabel}_${s.col}`, s]));
    // Columns run high→low left-to-right to match the web (seat 30 on the left, 1 on the right).
    // Each seat is a boxed number [NN]; chosen=cyan, taken=[··], ruedas=yellow, general=green, pref=magenta.
    for (const rl of rowLabels) {
      let line = style.dim(rl.padStart(2)) + " ";
      for (let col = maxCol; col >= minCol; col--) {
        const s = byKey.get(`${rl}_${col}`);
        if (!s) {
          line += "    ";
          continue;
        }
        const n = s.number.padStart(2, "0").slice(-2);
        if (chosen.has(s.seatId)) line += style.cyan(style.bold(`[${n}]`));
        else if (s.status !== "Available") line += style.red("[··]");
        else if (s.type === "Wheelchair" || s.type === "Companion") line += style.yellow(`[${n}]`);
        else if (pref) line += style.magenta(`[${n}]`);
        else line += style.green(`[${n}]`);
      }
      process.stdout.write(line.replace(/\s+$/, "") + "\n");
    }
  }
  process.stdout.write(
    "\n   " +
      [
        style.green("[00]") + " general",
        style.magenta("[00]") + " preferencial",
        style.yellow("[00]") + " ruedas",
        style.red("[··]") + " ocupada",
        style.cyan("[00]") + " elegida",
      ].join("  ") +
      "\n" + style.dim("   elegí por fila+número (ej: H12) o por seatId (ej: 1_3_5)") + "\n",
  );
}

// Friendly label for a seatId ("1_1_15" -> "H12"), for showing the chosen seats.
export function seatLabel(seatId: string, seats: Seat[]): string {
  const s = seats.find((x) => x.seatId === seatId);
  return s ? `${s.rowLabel}${s.number}` : seatId;
}

export interface ReserveResult {
  orderId: string;
  seats: string[];
  total?: number;
  paymentUrl: string;
}

const PAYMENT_URL = "https://multiplex.cinecolombia.com/order/payment?deliveryMode=Pickup";

export function paymentUrl(): string {
  return PAYMENT_URL;
}

// NOTE: order status polling is browser-based (orderStatusViaBrowser in
// cinecolombia-token.ts) because order-scoped endpoints are Cloudflare-protected —
// a headless GET /orders/{id} returns 403 even with valid cookies. Catalog reads
// (sites/films/showtimes/seat-availability) are the ones that work headless.
