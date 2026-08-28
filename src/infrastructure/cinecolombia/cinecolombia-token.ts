// Acquire a Cine Colombia session via a browser-assisted step.
//
// Cine Colombia (Vista OCAPI) needs two things for member-scoped calls, and both are
// obtained through a real browser because of Cloudflare Turnstile (page) and reCAPTCHA
// (login):
//   1. appToken  — a Bearer JWT embedded in the homepage HTML ("authToken").
//   2. memberCookie — `vista-loyalty-member-authentication-token`, set after login.
// With both, plain fetch to the OCAPI works headless: `Authorization: Bearer <appToken>`
// plus `Cookie: vista-loyalty-member-authentication-token=<memberCookie>`. Browse needs
// only the appToken; member/purchase calls need both.
import { sleep, launch, runSync } from "../../shared/proc.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from "node:fs";

const DIR = join(homedir(), ".cinesco");
const FILE = join(DIR, "cinecolombia-session.json");
const LEGACY_TOKEN_FILE = join(DIR, "cinecolombia-token.txt");
const PORT = 9223;
const PROFILE = join(homedir(), ".cinesco-chrome");
const MEMBER_COOKIE = "vista-loyalty-member-authentication-token";

export interface Session {
  appToken: string;
  memberCookie?: string; // present once logged in
  cfClearance?: string; // Cloudflare clearance — required on WRITE calls
  userAgent?: string; // must match the UA that solved the Cloudflare challenge
  exp: number;
}

function sh(cmd: string, args: string[], timeoutMs = 20000) {
  return runSync(cmd, args, timeoutMs);
}
function cdpUp(): boolean {
  const r = sh("curl", ["-s", "-m", "3", `http://127.0.0.1:${PORT}/json/version`], 5000);
  return r.code === 0 && r.stdout.includes("Browser");
}
function ab(evalJs: string): string {
  const r = sh("agent-browser", ["--cdp", String(PORT), "eval", evalJs], 30000);
  return r.stdout.trim().split("\n").pop() ?? "";
}

// Read cookies at the CDP level — this sees HttpOnly cookies (the member cookie and
// cf_clearance are HttpOnly, so page-level cookieStore/document.cookie can NOT read them).
function cdpCookies(): Record<string, string> {
  const r = sh("agent-browser", ["--cdp", String(PORT), "cookies", "get", "--json"], 15000);
  try {
    const parsed = JSON.parse(r.stdout.trim());
    const arr = (parsed?.data?.cookies ?? parsed?.cookies ?? parsed) as { name: string; value: string }[];
    const out: Record<string, string> = {};
    for (const c of arr) out[c.name] = c.value;
    return out;
  } catch {
    return {};
  }
}

// Logged in when the member cookie exists (HttpOnly, read via CDP) or the header greets
// the user. The non-HttpOnly flag `vista-loyalty-member-is-authenticated` is a fast check.
function isLoggedIn(): boolean {
  const c = cdpCookies();
  if (c[MEMBER_COOKIE]) return true;
  if (c["vista-loyalty-member-is-authenticated"] === "true") return true;
  const hola = ab(`/Hola[,\\s]/.test(document.body.innerText) ? 'yes' : 'no'`).replace(/"/g, "");
  return hola === "yes";
}

export function tokenExp(token: string): number {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(p + "=".repeat((4 - (p.length % 4)) % 4), "base64").toString("utf8");
    return Number(JSON.parse(json).exp) || 0;
  } catch {
    return 0;
  }
}

export function loadSession(): (Session & { expired: boolean }) | null {
  if (existsSync(FILE)) {
    try {
      const s = JSON.parse(readFileSync(FILE, "utf8")) as Session;
      return { ...s, expired: s.exp > 0 && Date.now() / 1000 >= s.exp - 30 };
    } catch {
      /* fall through */
    }
  }
  // env override / legacy token-only file (browse only)
  const envTok = process.env.CINECO_TOKEN || (existsSync(LEGACY_TOKEN_FILE) ? readFileSync(LEGACY_TOKEN_FILE, "utf8").trim() : "");
  if (envTok) {
    const exp = tokenExp(envTok);
    return { appToken: envTok, exp, expired: exp > 0 && Date.now() / 1000 >= exp - 30 };
  }
  return null;
}

function saveSession(s: Session): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600);
}

export interface AcquireResult {
  saved: boolean;
  exp: number;
  loggedIn: boolean;
  file: string;
}

// Launch Chrome, wait out Cloudflare, optionally wait for the user to log in (member),
// then scrape the app token and (if present) the member cookie. `requireLogin` waits
// until the member cookie appears; otherwise it grabs whatever is available.
export async function acquireSession(requireLogin: boolean, log: (s: string) => void): Promise<AcquireResult> {
  if (sh("which", ["agent-browser"]).code !== 0) {
    throw new Error("necesito 'agent-browser' (npm i -g agent-browser) y Google Chrome.");
  }
  log("abriendo Chrome…");
  launch("open", ["-na", "Google Chrome", "--args", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "https://www.cinecolombia.com"]);

  // Wait for Cloudflare to clear.
  let ready = false;
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    if (!cdpUp()) continue;
    const title = ab("document.title").replace(/"/g, "");
    if (title && !/moment|verificaci|verification/i.test(title)) {
      ready = true;
      break;
    }
    log(`  … esperando (Cloudflare)`);
  }
  if (!ready) throw new Error("Cine Colombia no cargó (Cloudflare no pasó a tiempo)");

  if (requireLogin) {
    if (isLoggedIn()) {
      log("ya había una sesión iniciada ✓");
    } else {
      log("iniciá sesión en la ventana de Chrome (correo + clave + reCAPTCHA)…");
      let logged = false;
      for (let i = 0; i < 100; i++) {
        await sleep(3000);
        if (isLoggedIn()) {
          logged = true;
          break;
        }
        if (i % 4 === 0) log("  … esperando el login (o cerrá el CLI con Ctrl-C)");
      }
      if (!logged) throw new Error("no detecté el login (¿iniciaste sesión y resolviste el reCAPTCHA?). Volvé a intentar.");
      log("login detectado ✓");
    }
  }

  // Read HttpOnly cookies via CDP (page JS can't see them).
  const ck = cdpCookies();
  const appToken = ab(`(async () => { const t = await (await fetch(location.origin)).text(); const m = t.match(/"authToken":"([^"]+)"/); return m ? m[1] : ""; })()`).replace(/^"|"$/g, "");
  const memberCookie = ck[MEMBER_COOKIE] || "";
  const cfClearance = ck["cf_clearance"] || "";
  const userAgent = ab(`navigator.userAgent`).replace(/^"|"$/g, "");

  // Keep the browser OPEN. The member cookie is a session cookie, so closing the browser
  // logs it out and every subsequent WRITE (order create/pay) would 403 at Cloudflare.
  // The warm, logged-in browser is what makes writes work.

  if (!appToken || appToken.split(".").length !== 3) throw new Error("no encontré el token de app en la página");
  const session: Session = {
    appToken,
    memberCookie: memberCookie || undefined,
    cfClearance: cfClearance || undefined,
    userAgent: userAgent || undefined,
    exp: tokenExp(appToken),
  };
  saveSession(session);
  return { saved: true, exp: session.exp, loggedIn: Boolean(memberCookie), file: FILE };
}

export function sessionFile(): string {
  return FILE;
}
export const memberCookieName = MEMBER_COOKIE;

export interface OrderStatusResult {
  exists: boolean;
  status?: string; // "InProgress" (pendiente) | "Completed"/"Confirmed" (pagado)
  paid: boolean;
  total?: number;
}

// Order-scoped reads are Cloudflare-protected (unlike the public catalog), so the order
// status is fetched in the browser too. 404 = cancelled/expired; a completed/confirmed
// status = the payment landed.
export async function orderStatusViaBrowser(orderId: string, log: (s: string) => void): Promise<OrderStatusResult> {
  await ensureBrowser(log);
  const r = parsePageFetch(pageFetch("GET", `/orders/${orderId}`, undefined));
  if (r.status === 404) return { exists: false, paid: false };
  if (r.status !== 200) throw new Error(`no pude consultar la orden (HTTP ${r.status})`);
  const o = (r.body as { order?: { status?: string; totalPrice?: { valueIncludingTax?: number } } })?.order;
  const status = o?.status;
  return {
    exists: true,
    status,
    paid: /completed|confirmed|paid|finaliz/i.test(status ?? ""),
    total: o?.totalPrice?.valueIncludingTax,
  };
}

// Ensure a logged-in Chrome with CDP is running. Cine Colombia WRITES must go through
// the real browser because Cloudflare fingerprints the TLS client (JA3) on writes — a
// curl/Bun request with valid cookies still gets 403. Reads are fine headless.
// True once the homepage yields the app token via a page fetch — i.e. Cloudflare has
// cleared (cf_clearance is set) and writes will succeed. A cleared title is not enough.
function tokenReady(): boolean {
  const r = ab(`(async () => { try { const t = await (await fetch('https://www.cinecolombia.com/')).text(); return /"authToken":"[^"]+"/.test(t) ? 'yes' : 'no'; } catch (e) { return 'no'; } })()`);
  return r.replace(/"/g, "") === "yes";
}

// Ensure a warm, LOGGED-IN browser: writes (order/pay) need it, because the member
// session cookie dies on browser close and Cloudflare only trusts an interactively
// logged-in session for writes. If the browser is cold or logged out, this launches it
// and waits for the user to sign in — then leaves it open.
// Cloudflare grants WRITE-level trust only to a browser where the user solved the
// Turnstile/reCAPTCHA interactively (a plain programmatic launch, even with valid
// cookies, gets 403 on writes). So: if a warm, write-capable browser is already open we
// reuse it; otherwise we launch one, clear the stale auth to force a fresh interactive
// login, and wait for the user to sign in — then keep it open.
let browserWarmedThisRun = false;

async function ensureBrowser(log: (s: string) => void): Promise<void> {
  if (browserWarmedThisRun && cdpUp() && isLoggedIn()) return;

  const coldLaunch = !cdpUp();
  if (coldLaunch) {
    log("abriendo Chrome (la compra se hace en el navegador)…");
    launch("open", ["-na", "Google Chrome", "--args", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "https://www.cinecolombia.com"]);
  }
  // Wait for Cloudflare / the page to be ready.
  let ready = false;
  for (let i = 0; i < 25; i++) {
    await sleep(2000);
    if (cdpUp() && tokenReady()) {
      ready = true;
      break;
    }
    if (i === 4) log("  … esperando a Cloudflare");
  }
  if (!ready) throw new Error("Cine Colombia no cargó a tiempo. Volvé a intentar.");

  // A cold-launched browser has only a cached (bot-scored) session — force a fresh
  // interactive login so Cloudflare grants write trust.
  if (coldLaunch) {
    ab(`(async()=>{try{await cookieStore.delete('${MEMBER_COOKIE}')}catch(e){};try{await cookieStore.delete('vista-loyalty-member-is-authenticated')}catch(e){};return 1})()`);
  }
  if (coldLaunch || !isLoggedIn()) {
    log("iniciá sesión en la ventana de Chrome (correo + clave + reCAPTCHA) para habilitar la compra…");
    let ok = false;
    for (let i = 0; i < 100; i++) {
      await sleep(3000);
      if (isLoggedIn()) {
        ok = true;
        break;
      }
      if (i % 4 === 0) log("  … esperando el login");
    }
    if (!ok) throw new Error("no detecté el login. Iniciá sesión en Chrome y reintentá.");
    log("login ok ✓");
  }
  browserWarmedThisRun = true;
}

// Run a fetch inside the page context and return the parsed JSON result. The page holds
// the app token, the member cookie and the Cloudflare clearance with a real browser TLS
// fingerprint, so writes succeed here where headless fetch is blocked.
function pageFetch(method: string, apiPath: string, body: unknown): string {
  const bodyJs = body === undefined ? "undefined" : `JSON.stringify(${JSON.stringify(body)})`;
  const js = `(async () => {
    const html = await (await fetch(location.origin)).text();
    const tok = (html.match(/"authToken":"([^"]+)"/) || [])[1];
    const r = await fetch('https://digital-api.cinecolombia.com/ocapi/v1${apiPath}', {
      method: '${method}',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: ${bodyJs},
      credentials: 'include',
    });
    const t = await r.text();
    return JSON.stringify({ status: r.status, body: t });
  })()`;
  return ab(js);
}

function parsePageFetch(raw: string): { status: number; body: unknown } {
  // ab() returns the value possibly wrapped in quotes with escaped JSON.
  let s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = JSON.parse(s);
  const outer = JSON.parse(s) as { status: number; body: string };
  let body: unknown = outer.body;
  try {
    body = JSON.parse(outer.body);
  } catch {
    /* keep string */
  }
  return { status: outer.status, body };
}

export interface BrowserReserveResult {
  orderId: string;
  total?: number;
}

// Create an order and hold seats, executed in the browser (Cloudflare-safe).
export async function reserveViaBrowser(
  siteId: string,
  showtimeId: string,
  seatIds: string[],
  log: (s: string) => void,
): Promise<BrowserReserveResult> {
  await ensureBrowser(log);
  log("creando la orden…");
  const booking = parsePageFetch(pageFetch("POST", "/orders/standard/booking", { siteId, bookingMode: "Paid" }));
  if (booking.status !== 200) throw new Error(`no se pudo crear la orden (HTTP ${booking.status})`);
  const orderId = (booking.body as { order?: { id?: string } })?.order?.id;
  if (!orderId) throw new Error("la orden no devolvió id");
  log(`orden ${orderId} · seleccionando butacas…`);
  const upd = parsePageFetch(pageFetch("PUT", `/orders/${orderId}/showtimes/${showtimeId}`, { seats: seatIds, tickets: [] }));
  if (upd.status !== 200) {
    // best effort release, then fail
    pageFetch("DELETE", `/orders/${orderId}`, undefined);
    throw new Error(`no se pudieron seleccionar las butacas (HTTP ${upd.status})`);
  }
  const total = (upd.body as { order?: { totalPrice?: { valueIncludingTax?: number } } })?.order?.totalPrice?.valueIncludingTax;
  return { orderId, total };
}

export async function cancelViaBrowser(orderId: string, log: (s: string) => void): Promise<void> {
  await ensureBrowser(log);
  const r = parsePageFetch(pageFetch("DELETE", `/orders/${orderId}`, undefined));
  if (r.status !== 204 && r.status !== 200) throw new Error(`no se pudo cancelar (HTTP ${r.status})`);
}

export interface CheckoutResult {
  orderId: string;
  total?: number;
  paymentUrl: string;
}

// Full checkout, executed in one browser eval (Cloudflare-safe): create order → hold
// seats → add one ticket per seat → set customer (best-effort) → request the payment
// redirect. Returns the Vista Web Payment URL (which forwards to PlacetoPay). The CLI
// never pays; the human completes payment in the browser.
export async function checkoutViaBrowser(
  siteId: string,
  showtimeId: string,
  seatIds: string[],
  log: (s: string) => void,
): Promise<CheckoutResult> {
  await ensureBrowser(log);
  log("creando la orden y el pago…");
  const seatsJson = JSON.stringify(seatIds);
  const js = `(async () => {
    const html = await (await fetch('https://www.cinecolombia.com/')).text();
    const tok = (html.match(/"authToken":"([^"]+)"/) || [])[1];
    const H = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok };
    const B = 'https://digital-api.cinecolombia.com/ocapi/v1';
    const F = (m, p, b) => fetch(B + p, { method: m, headers: H, credentials: 'include', body: b ? JSON.stringify(b) : undefined });
    const seats = ${seatsJson};
    let oid = null;
    for (let i = 0; i < 3 && !oid; i++) {
      if (i) await new Promise(r => setTimeout(r, 1500));
      try { const bk = await (await F('POST', '/orders/standard/booking', { siteId: '${siteId}', bookingMode: 'Paid' })).json(); oid = bk.order && bk.order.id; } catch (e) {}
    }
    if (!oid) return JSON.stringify({ error: 'Cloudflare bloqueó la compra. Corré \\'cinesco cinecolombia login\\', resolvé el reCAPTCHA, dejá esa ventana de Chrome ABIERTA y reintentá.' });
    await F('PUT', '/orders/' + oid + '/showtimes/${showtimeId}', { seats, tickets: [] });
    const tp = (await (await F('GET', '/showtimes/${showtimeId}/ticket-prices')).json()).ticketPrices;
    const def = (tp.find(t => t.isDefault) || tp[0]);
    const tickets = seats.map(() => ({ id: crypto.randomUUID(), ticketTypeId: def.ticketTypeId }));
    await F('PUT', '/orders/' + oid + '/showtimes/${showtimeId}', { seats, tickets });
    try {
      const me = (await (await F('GET', '/members/current')).json()).member;
      const nm = me.personalDetails.name.givenName + ' ' + me.personalDetails.name.familyName;
      const doc = (me.taxDetails && me.taxDetails.number) || '';
      const ph = me.personalDetails.phoneNumber || me.personalDetails.mobilePhoneNumber || '3000000000';
      await F('PUT', '/orders/' + oid + '/customer', { name: nm, email: me.credentials.email, phoneNumber: ph, preferences: { languageTag: 'es-419' }, taxDetails: { name: nm, number: doc } });
    } catch (e) {}
    const payR = await F('POST', '/orders/' + oid + '/payments/redirect', { webPaymentMethodId: 2, redirectReturnUrl: 'https://multiplex.cinecolombia.com/order/payment?deliveryMode=Pickup', languageTag: 'es-419' });
    const pay = await payR.json();
    return JSON.stringify({ orderId: oid, status: payR.status, url: pay.redirectUrl, value: pay.redirectPayment && pay.redirectPayment.value });
  })()`;
  const raw = ab(js);
  let out: { orderId?: string; status?: number; url?: string; value?: number; error?: string };
  try {
    let s = raw.trim();
    if (s.startsWith('"') && s.endsWith('"')) s = JSON.parse(s);
    out = JSON.parse(s);
  } catch {
    throw new Error("no pude interpretar la respuesta del checkout");
  }
  if (out.error) throw new Error(out.error);
  if (!out.url) throw new Error(`no se generó el link de pago (HTTP ${out.status ?? "?"})`);
  return { orderId: out.orderId!, total: out.value, paymentUrl: out.url };
}
