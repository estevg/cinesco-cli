#!/usr/bin/env bun
// Cines Co CLI — one terminal over multiple Colombian cinema chains.
// Ask which chain, then run that provider's adapter. Agent-first: --json auto
// off-TTY, schema command, exit codes 0/1/2, data on stdout / banner on stderr.
import { sleep, launch } from "../shared/proc.ts";
import { resolveDate } from "../shared/dates.ts";
import { PROVIDERS, getProvider } from "../infrastructure/registry.ts";
import type { Provider } from "../domain/ports.ts";
import type { Showtime, Movie, Session } from "../domain/entities.ts";
import { emitJson, jsonMode, style, heading, table, note, errline } from "../shared/output.ts";
import { promptSelect } from "../shared/prompt.ts";
import { acquireSession, loadSession, reserveViaBrowser, cancelViaBrowser, checkoutViaBrowser, orderStatusViaBrowser } from "../infrastructure/cinecolombia/cinecolombia-token.ts";
import { whoami as ccWhoami, showtimeSeats as ccSeats, paintSeats as ccPaint, paymentUrl as ccPayUrl } from "../infrastructure/cinecolombia/cinecolombia.ts";

// Poll an order until it is paid, cancelled/expired, or the timeout elapses. Order reads
// are Cloudflare-protected, so this polls through the browser.
async function ccWaitPayment(orderId: string, log: (s: string) => void): Promise<"paid" | "cancelled" | "timeout"> {
  const deadline = Date.now() + 10 * 60 * 1000; // 10 min (orders expire around then)
  let last = "";
  while (Date.now() < deadline) {
    await sleep(5000);
    let st;
    try {
      st = await orderStatusViaBrowser(orderId, () => {});
    } catch {
      continue;
    }
    if (!st.exists) return "cancelled";
    if (st.paid) return "paid";
    if (st.status && st.status !== last) {
      log(`  … estado: ${st.status} (esperando el pago)`);
      last = st.status;
    }
  }
  return "timeout";
}
import { cinemark as cmkProvider } from "../infrastructure/cinemark/index.ts";
import { loadCinemark as cmkLoadSession, cinemarkExpired as cmkExpired } from "../infrastructure/cinemark/session.ts";
import { PurchaseTickets } from "../application/purchase.ts";
import { BrowseCatalog } from "../application/browse.ts";
import { resolveSeats as cmkResolve, defaultFare } from "../application/seats.ts";
import { paintSeatMap } from "./seatmap.ts";
import { doctorCmd } from "./doctor.ts";
import { skillsCmd } from "./skills.ts";
import { bigText } from "./bigtext.ts";
import { BANNERS, type Banner } from "./banners.ts";
import { occupancyLine, occLine } from "./occupancy.ts";
import { auditPending } from "../shared/audit.ts";
import { login as rfLogin, requireToken as rfRequireToken } from "../infrastructure/royalfilms/auth.ts";
import { loadSession as rfLoadSession, isExpired as rfIsExpired, decodeJwt as rfDecodeJwt } from "../infrastructure/royalfilms/session.ts";
import { apiGet as rfApiGet } from "../infrastructure/royalfilms/api.ts";
import { releaseReserve as rfReleaseReserve } from "../infrastructure/royalfilms/reserve.ts";

type Row = Record<string, unknown>;

// Royal Films sales are readable headless. Snapshot the user's ticket sale ids, then
// poll until a NEW one appears — that is the payment landing (a sale gets created).
async function rfSaleIds(token: string, doc: string): Promise<Set<number>> {
  const d = await rfApiGet<{ redeemed?: Row[]; unredeemed?: Row[] }>(`/ticket/document/${doc}`, token);
  const ids = new Set<number>();
  for (const s of [...(d.redeemed ?? []), ...(d.unredeemed ?? [])]) ids.add(Number(s.venta_id));
  return ids;
}

async function rfWaitPayment(token: string, doc: string, log: (s: string) => void): Promise<{ outcome: "paid" | "timeout"; venta?: Row }> {
  const before = await rfSaleIds(token, doc);
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    try {
      const d = await rfApiGet<{ redeemed?: Row[]; unredeemed?: Row[] }>(`/ticket/document/${doc}`, token);
      const all = [...(d.redeemed ?? []), ...(d.unredeemed ?? [])];
      const fresh = all.find((s) => !before.has(Number(s.venta_id)));
      if (fresh) return { outcome: "paid", venta: fresh };
    } catch {
      /* transient */
    }
  }
  return { outcome: "timeout" };
}

function rfDocFromToken(token: string): string {
  const u = (rfDecodeJwt(token).user ?? {}) as Record<string, unknown>;
  return String(u.usuario_cliente_documento ?? "");
}

const VERSION = "0.1.0";

function openInBrowser(target: string): void {
  try {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    launch(cmd, [target]);
  } catch {
    /* best effort */
  }
}

function parseArgs(argv: string[]) {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[key] = argv[++i];
      else flags[key] = "true";
    } else positionals.push(a);
  }
  return { positionals, flags, json };
}

// True-colour tricolor "CINESCO" wordmark rendered with upper-half-block ▀
// (foreground = top pixel, background = bottom pixel → 2x vertical resolution).
// STDERR only, so it never contaminates JSON/piped stdout.
function paintBanner(b: Banner): void {
  const fg = (i: number) => { const c = b.palette[i - 1]; return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`; };
  const bg = (i: number) => { const c = b.palette[i - 1]; return `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`; };
  const RS = "\x1b[0m";
  let out = "\n";
  for (let y = 0; y < b.rows.length; y += 2) {
    const top = b.rows[y], bot = b.rows[y + 1] ?? "";
    for (let x = 0; x < b.w; x++) {
      const t = +(top[x] ?? "0"), bb = +(bot[x] ?? "0");
      if (!t && !bb) out += " ";
      else if (t && bb) out += fg(t) + bg(bb) + "▀" + RS;
      else if (t) out += fg(t) + "▀" + RS;
      else out += fg(bb) + "▄" + RS;
    }
    out += "\n";
  }
  process.stderr.write(out);
}

// `bannerId` picks the wordmark (a chain id or "cinesco"); falls back to the
// cinesco block-letter art on non-true-colour / NO_COLOR terminals.
function logo(bannerId = "cinesco"): void {
  if (!process.stdout.isTTY) return;
  const truecolor = !process.env.NO_COLOR && /truecolor|24bit/i.test(process.env.COLORTERM ?? "");
  if (truecolor && BANNERS[bannerId]) {
    paintBanner(BANNERS[bannerId]);
    process.stderr.write(style.dim(`   v${VERSION} · una terminal, todas las salas de cine\n`));
    return;
  }
  // Fallback for 256-colour / NO_COLOR terminals: block-letter wordmark.
  const strip = style.dim("▐▌ ".repeat(16).trimEnd());
  process.stderr.write("\n" + strip + "\n");
  for (const l of [
    " ██████╗██╗███╗   ██╗███████╗███████╗     ██████╗ ██████╗",
    "██╔════╝██║████╗  ██║██╔════╝██╔════╝    ██╔════╝██╔═══██╗",
    "██║     ██║██╔██╗ ██║█████╗  ███████╗    ██║     ██║   ██║",
    "██║     ██║██║╚██╗██║██╔══╝  ╚════██║    ██║     ██║   ██║",
    "╚██████╗██║██║ ╚████║███████╗███████║    ╚██████╗╚██████╔╝",
    " ╚═════╝╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝     ╚═════╝ ╚═════╝",
  ])
    process.stderr.write(style.bold(style.cyan(l)) + "\n");
  process.stderr.write(style.dim(`   v${VERSION} · una terminal, todas las salas de cine\n`) + strip + "\n");
}

function providersCmd(json: boolean): void {
  const rows = PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    pais: p.country,
    auth: p.auth,
    capacidades: Object.entries(p.capabilities)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(","),
  }));
  if (json) {
    emitJson({ ok: true, command: "providers", count: rows.length, data: PROVIDERS.map((p) => ({ id: p.id, name: p.name, country: p.country, auth: p.auth, notes: p.notes, capabilities: p.capabilities })) });
  } else {
    heading("Cadenas disponibles");
    table(rows, [
      { key: "id", label: "ID", color: style.cyan },
      { key: "name", label: "Cadena" },
      { key: "pais", label: "País" },
      { key: "auth", label: "Login" },
      { key: "capacidades", label: "Capacidades", max: 34 },
    ]);
  }
}

// Section order for the human help, shared by the global schema and per-chain help.
const SCHEMA_SECTIONS = ["Explorar", "Sesión", "Comprar", "Gestión", "Utilidad"];
type CommandRow = { group: string; command: string; args: string[]; summary: string };

const SCHEMA_COMMANDS: CommandRow[] = [
  { group: "Explorar", command: "providers", args: [], summary: "Listar las cadenas" },
  { group: "Explorar", command: "<provider> regions", args: [], summary: "Ciudades/regiones con su ID (Royal Films/Cinemark exigen ese ID; empezá por acá)" },
  { group: "Explorar", command: "<provider> cinemas", args: ["[region]"], summary: "Cines de una cadena (region = ID de 'regions')" },
  { group: "Explorar", command: "<provider> movies", args: ["[region]", "[--filter <texto>]"], summary: "Cartelera (filtrable; resume si es larga)" },
  { group: "Explorar", command: "<provider> showtimes", args: ["movieId", "[region]", "[--date hoy|mañana|viernes]", "[--occupancy]"], summary: "Funciones (agrupadas por cine; --occupancy pinta la ocupación por función)" },
  { group: "Explorar", command: "search", args: ["<pelicula>", "--city"], summary: "Buscar una peli en las 3 cadenas a la vez" },
  { group: "Sesión", command: "<provider> login", args: [], summary: "Guardar sesión (las 3 cadenas). Se reusa en buy/order" },
  { group: "Sesión", command: "<provider> status", args: [], summary: "¿Hay sesión activa y de quién?" },
  { group: "Comprar", command: "<provider> seats", args: ["--cinema", "--session", "--hall"], summary: "Butacas libres + precio por butaca (--hall lo pide Royal Films)" },
  { group: "Comprar", command: "<provider> fares", args: ["--cinema", "--session", "--hall"], summary: "Tipos de boleta + precio (vacío si la función tiene tarifa única)" },
  { group: "Comprar", command: "<provider> order", args: ["--cinema", "--session", "--hall", "--seats", "--movie", "--region", "[--bank]", "[--dry-run]"], summary: "Reservar + link de pago (no cobra). --dry-run previsualiza sin reservar" },
  { group: "Comprar", command: "<provider> buy", args: [], summary: "Asistente de compra completo de una cadena (interactivo)" },
  { group: "Comprar", command: "start", args: [], summary: "Asistente: elegí cadena y explorá (interactivo)" },
  { group: "Gestión", command: "<provider> pending", args: [], summary: "Ventas en proceso (Royal Films)" },
  { group: "Gestión", command: "<provider> cancel", args: ["<id>"], summary: "Liberar un hold (Royal Films) o cancelar una orden (Cine Colombia)" },
  { group: "Utilidad", command: "doctor", args: [], summary: "Qué está instalado / logueado y cómo arreglar cada hueco" },
  { group: "Utilidad", command: "skills", args: [], summary: "Manual para agentes servido por el binario" },
  { group: "Utilidad", command: "schema", args: ["[--json]"], summary: "Esta superficie (alias: --help, -h, help)" },
];

// Print commands grouped under their section headings (STDERR, human mode).
function renderCommandGroups(cmds: CommandRow[]): void {
  for (const group of SCHEMA_SECTIONS) {
    const rows = cmds.filter((c) => c.group === group);
    if (!rows.length) continue;
    process.stderr.write(style.bold(style.cyan(`\n  ${group}\n`)));
    table(rows, [
      { key: "command", label: "Comando", color: style.cyan },
      { key: "summary", label: "Descripción", max: 58 },
    ]);
  }
}

function schemaCmd(json: boolean): void {
  const spec = {
    name: "cinesco",
    version: VERSION,
    schemaVersion: 1,
    providers: PROVIDERS.map((p) => ({ id: p.id, name: p.name, auth: p.auth, capabilities: p.capabilities })),
    commands: SCHEMA_COMMANDS,
    exitCodes: { "0": "ok", "1": "api/network", "2": "usage" },
  };
  if (json) emitJson({ ok: true, command: "schema", data: spec });
  else {
    logo();
    heading(`cinesco schema v${spec.schemaVersion}`);
    renderCommandGroups(SCHEMA_COMMANDS);
    note(style.dim("\ntip: 'cinesco <cadena> login' guarda tu sesión; luego seats/order la reusan solos."));
  }
}

// Per-chain help: `cinesco <chain> --help` / `<chain>` / `<chain> help`.
// Same surface as the global schema, scoped to one chain (id substituted,
// session verbs dropped for chains without a saved session).
function providerHelp(p: Provider, json: boolean): number {
  const hasSession = p.id === "royalfilms" || p.id === "cinecolombia" || p.id === "cinemark";
  const cmds = SCHEMA_COMMANDS
    .filter((c) => c.command.startsWith("<provider>") || c.command === "search" || c.command === "start")
    .filter((c) => hasSession || !/ (login|status)$/.test(c.command))
    .filter((c) => p.id === "royalfilms" || !/ pending$/.test(c.command))
    .filter((c) => p.id === "royalfilms" || p.id === "cinecolombia" || !/ cancel$/.test(c.command))
    .map((c) => ({ ...c, command: c.command.replace("<provider>", p.id) }));
  if (json) {
    emitJson({ ok: true, command: `${p.id} help`, data: { id: p.id, name: p.name, auth: p.auth, notes: p.notes, capabilities: p.capabilities, commands: cmds } });
    return 0;
  }
  logo(p.id);
  heading(`${p.name}  ·  ${p.auth === "browser-assisted" ? "login por navegador" : "login directo"}`);
  if (p.notes) note(p.notes);
  renderCommandGroups(cmds);
  const first = hasSession ? `cinesco ${p.id} login` : `cinesco ${p.id} regions`;
  note(style.dim(`\nej: ${first}  →  ${p.id} showtimes <movieId> <region>  →  ${p.id} order …`));
  return 0;
}

// A browse operation shared by the provider subcommands.
// Reject an invalid region up front instead of returning an empty list (which
// looked identical to a real but empty city). Suggests the right id by name.
async function assertRegion(p: Provider, region: string | undefined): Promise<void> {
  if (!region || !p.catalog.listRegions) return;
  const regions = await p.catalog.listRegions();
  if (regions.some((r) => r.id === region)) return;
  const q = region.toLowerCase();
  const near = regions.filter((r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase() === q);
  const hint = near.length
    ? `¿quisiste decir ${near.slice(0, 3).map((r) => `${r.id} (${r.name})`).join(" · ")}?`
    : `corré 'cinesco ${p.id} regions' para ver los IDs`;
  throw new UsageError(`region "${region}" no existe en ${p.name}. ${hint}`);
}

// Get a session without prompting: a saved login first, then env/flag credentials.
async function tryEnvLogin(p: Provider, flags: Record<string, string>): Promise<import("../domain/entities.ts").Session | null> {
  if (!p.purchase) return null;
  const restored = p.purchase.restore ? await p.purchase.restore() : null;
  if (restored) return restored;
  const env = (k: string) => process.env[`${p.id.toUpperCase()}_${k}`];
  const email = flags.email || env("EMAIL");
  const password = flags.password || env("PASSWORD");
  if (!email || !password) return null;
  try { return await p.purchase.login({ email: email.trim(), password }); } catch { return null; }
}

// Fill seatsFree/seatsTotal on each showtime by fetching its seat map. One call
// per showtime, so it is bounded and behind the --occupancy flag. Browser-assisted
// chains (Cine Colombia) are skipped in this fast path.
async function enrichOccupancy(p: Provider, data: Showtime[], flags: Record<string, string>, json: boolean): Promise<void> {
  if (p.auth === "browser-assisted") {
    if (!json) note(style.yellow(`${p.name}: ocupación no disponible en modo rápido (requiere navegador) — usá 'seats' por función.`));
    return;
  }
  const session = await tryEnvLogin(p, flags);
  if (!session) {
    if (!json) note(style.yellow(`ocupación: necesitás sesión — corré 'cinesco ${p.id} login' o poné ${p.id.toUpperCase()}_EMAIL / ${p.id.toUpperCase()}_PASSWORD.`));
    return;
  }
  const CAP = 24;
  const targets = data.slice(0, CAP);
  if (!json && data.length > CAP) note(style.dim(`ocupación: consultando ${CAP} de ${data.length} funciones…`));
  const purchase = new PurchaseTickets(p.purchase!);
  let done = 0;
  for (const st of targets) {
    try {
      const seats = (await purchase.seatMap(st, session)).rows.flatMap((r) => r.seats);
      st.seatsTotal = seats.length;
      st.seatsFree = seats.filter((x) => x.available).length;
    } catch { /* leave this one without occupancy */ }
    if (!json) process.stderr.write(`\r  … ${++done}/${targets.length}`);
  }
  if (!json) process.stderr.write("\r\x1b[K");
}

async function runProviderVerb(p: Provider, verb: string, pos: string[], flags: Record<string, string>, json: boolean): Promise<number> {
  const region = pos[0] || flags.region;
  const cmd = `${p.id} ${verb}`;
  try {
    if (verb === "cinemas") {
      await assertRegion(p, region);
      const data = await p.catalog.listCinemas(region);
      out(json, cmd, data, ["<provider> movies [region]"], () => {
        heading(`${p.name} · cines${region ? ` (region ${region})` : ""}`);
        table(data, [{ key: "id", label: "ID", color: style.cyan }, { key: "name", label: "Cine" }]);
      });
    } else if (verb === "movies") {
      await assertRegion(p, region);
      let data = await p.catalog.listMovies(region);
      const filter = flags.filter || flags.grep;
      if (filter) { const q = norm(filter); data = data.filter((m) => norm(m.title).includes(q)); }
      out(json, cmd, data, data[0] ? [`${p.id} showtimes ${data[0].id} ${region ?? "[region]"}`] : [], () => {
        heading(`${p.name} · cartelera${filter ? ` · "${filter}"` : region ? ` (${region})` : ""}`);
        if (!data.length) { note(filter ? `sin coincidencias para "${filter}"` : "sin cartelera"); return; }
        // The billboard can be long (Cine Colombia lists ~90 nationwide). A person
        // asked "what's on", not for 90 rows — cap it and point at the filter.
        const CAP = 25;
        table(data.slice(0, CAP), [{ key: "id", label: "ID", color: style.cyan }, { key: "title", label: "Película", max: 50 }]);
        note(style.dim(data.length > CAP
          ? `mostrando 25 de ${data.length} · filtrá con --filter <texto>, o --json para todas`
          : `${data.length} película(s)`));
      });
    } else if (verb === "showtimes") {
      const movieId = pos[0];
      if (!movieId) throw new UsageError("falta movieId");
      const reg = pos[1] || flags.region;
      await assertRegion(p, reg);
      let data = await p.catalog.listShowtimes({ movieId, regionId: reg, cinemaId: flags.cinema });
      if (flags.date) {
        const d = resolveDate(flags.date);
        if (!d) throw new UsageError(`fecha no reconocida: "${flags.date}" (usá hoy | mañana | <día de semana> | YYYY-MM-DD)`);
        data = data.filter((s) => s.date === d);
      }
      // Opt-in occupancy: one seat-map fetch per showtime (needs a session), so
      // it is a flag, not the default. Browse stays cheap.
      if (flags.occupancy !== undefined) await enrichOccupancy(p, data, flags, json);
      // Hand the agent the exact next command with every id already filled in —
      // seats/order otherwise need cinema+hall+session(+movie+region) that only
      // this row knows, and the schema can't pre-fill.
      const steps: string[] = [];
      if (data[0]) {
        const s = data[0];
        const loc = [`--cinema ${s.cinemaId}`, s.hall ? `--hall ${s.hall}` : "", `--session ${s.id}`].filter(Boolean).join(" ");
        steps.push(`${p.id} seats ${loc}`);
        steps.push([`${p.id} order`, loc, `--movie ${movieId}`, reg ? `--region ${reg}` : "", "--seats <labels>"].filter(Boolean).join(" "));
      }
      out(json, cmd, data, steps, () => {
        heading(`${p.name} · funciones de ${movieId}`);
        // The cinema repeats down every row — promote it to a heading and let
        // the rows carry only what varies (repetition is a heading, human-output).
        const byCinema = new Map<string, typeof data>();
        for (const s of data) {
          const k = s.cinemaName || `cine ${s.cinemaId}`;
          if (!byCinema.has(k)) byCinema.set(k, []);
          byCinema.get(k)!.push(s);
        }
        const withOcc = data.some((s) => s.seatsTotal != null);
        for (const [cinema, fns] of byCinema) {
          process.stderr.write(style.bold(style.cyan(`\n  ${cinema}\n`)));
          if (withOcc) {
            // Butaca-style line: hora · función · sala · ocupación (bar + word).
            for (const s of fns) {
              const occ = s.seatsTotal ? occLine(s.seatsFree ?? 0, s.seatsTotal) : style.dim("ocupación n/d");
              note(`  ${style.bold(s.time ?? "—")}  ${style.dim(s.id)}  sala ${s.hall ?? "?"}  ${occ}`);
            }
          } else {
            table(fns, [
              { key: "date", label: "Fecha" },
              { key: "time", label: "Hora", color: style.bold },
              { key: "format", label: "Formato" },
              { key: "hall", label: "Sala" },
              { key: "id", label: "Función", color: style.dim },
            ]);
          }
        }
      });
    } else if (verb === "regions") {
      if (!p.catalog.listRegions) throw new UsageError(`${p.name} no maneja regiones`);
      const data = await p.catalog.listRegions();
      out(json, cmd, data, [`${p.id} cinemas <region>`], () => {
        heading(`${p.name} · ciudades`);
        table(data, [{ key: "id", label: "ID", color: style.cyan }, { key: "name", label: "Ciudad" }]);
      });
    } else {
      throw new UsageError(`verbo desconocido: ${verb} (probá cinemas | movies | showtimes | regions)`);
    }
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      if (json) emitJson({ ok: false, command: cmd, error: { code: "usage", message: e.message } });
      else errline(`${cmd}: ${e.message}`);
      return 2;
    }
    const msg = (e as Error).message ?? String(e);
    const code = msg.includes("not-implemented") ? "not-implemented" : "provider-error";
    if (json) emitJson({ ok: false, command: cmd, error: { code, message: msg } });
    else errline(`${cmd}: ${msg}`);
    return 1;
  }
}

class UsageError extends Error {}

function out(json: boolean, command: string, data: unknown[], nextSteps: string[], human: () => void): void {
  if (json) emitJson({ ok: true, command, count: Array.isArray(data) ? data.length : undefined, data, nextSteps });
  else {
    human();
    // Emit a runnable command, not a fragment the reader has to prefix (human-output).
    if (nextSteps.length) note("\nsiguiente: " + nextSteps.map((s) => style.dim(runnable(s))).join("  ·  "));
  }
}

// Prefix a next-step with `cinesco ` so it pastes and runs as-is.
function runnable(step: string): string {
  return /^(cinesco|abrí|open|repetí|para )/.test(step) ? step : `cinesco ${step}`;
}

// Interactive: pick a chain, then explore its browse surface.
async function startWizard(): Promise<number> {
  if (!process.stdin.isTTY) {
    errline("'start' es interactivo; usá los comandos sueltos (cinesco <provider> movies) en modo automático.");
    return 2;
  }
  logo();
  const i = await promptSelect(
    "¿En qué cine querés comprar o reservar?",
    PROVIDERS.map((p) => `${p.name}  (${p.country})`),
  );
  if (i === null) return 2;
  const p = PROVIDERS[i];
  const banner = bigText(p.name);
  if (banner) process.stdout.write("\n" + style.bold(style.cyan(banner)) + "\n");
  note(style.dim(`   v${VERSION}`));
  note(`${style.dim(p.notes ?? "")}\n`);

  // Every chain now exposes a PurchasePort — one flow drives them all (the wizard
  // branches on `auth` for the browser-assisted login).
  if (p.purchase) return runPurchaseWizard(p);
  note(`${p.name} no tiene compra por API todavía.`);
  return 0;
}

// Full Cinemark flow (100% headless): login → ciudad → peli → función → butacas →
// boleta → orden → banco PSE → link de pago. Never charges; stops at the PSE link.
// Full Cinemark flow (100% headless) via the clean use cases: login → ciudad → peli →
// cine → función → butacas → boleta → orden → banco PSE → link. Never charges.
// Full purchase flow via the clean use cases, generic over any provider with a
// PurchasePort (Royal Films, Cinemark): login → ciudad → peli → cine → función →
// butacas → (boleta) → (banco) → checkout → link. Never charges.
async function runPurchaseWizard(provider: Provider): Promise<number> {
  if (!provider.purchase) {
    errline(`${provider.name} no tiene compra por API todavía.`);
    return 2;
  }
  // Interactive-only: never spin on prompts that can't be answered. Off-TTY,
  // fail with a structured error pointing at the agent verbs.
  if (!process.stdin.isTTY) {
    const msg = `'${provider.id} buy' es interactivo — corré en una terminal, o usá los verbos agent: seats · fares · order.`;
    if (jsonMode(false)) emitJson({ ok: false, command: `${provider.id} buy`, error: { code: "interactive-only", message: msg } });
    else errline(msg);
    return 2;
  }
  const { promptLine, promptSecret } = await import("../shared/prompt.ts");
  const browse = new BrowseCatalog(provider.catalog);
  const purchase = new PurchaseTickets(provider.purchase);
  const pick = async <T>(title: string, items: T[], label: (t: T) => string): Promise<T | null> => {
    if (items.length === 0) {
      note("no hay opciones en este paso");
      return null;
    }
    const idx = await promptSelect(title, items.map(label));
    return idx === null ? null : items[idx];
  };
  const fmtCOP = (n: number) => "$" + n.toLocaleString("es-CO");

  // 1) login — reuse a saved session first (cinesco <chain> login), else prompt.
  // Direct auth retries on a bad password; browser-assisted opens the browser.
  let session = await purchase.restore();
  const isNo = (s: string) => ["n", "no"].includes(s.trim().toLowerCase());
  if (session) {
    note(style.dim(`sesión guardada de ${provider.name} — no hace falta iniciar sesión.`));
  } else if (provider.auth === "browser-assisted") {
    note(style.yellow("necesitás iniciar sesión en el navegador (se hace una vez)."));
    const yn = (await promptLine("¿inicio sesión ahora? (s/N): ")) || "";
    if (yn.toLowerCase() !== "s" && yn.toLowerCase() !== "si") {
      note("ok, cancelado.");
      return 0;
    }
    try {
      session = await purchase.login({ email: "", password: "" });
    } catch (e) {
      errline((e as Error).message);
      return 1;
    }
  } else {
    for (;;) {
      const email = (await promptLine(`correo de socio ${provider.name}: `)) || "";
      const password = (await promptSecret("contraseña: ")) || "";
      if (!email || !password) {
        errline("necesito correo y contraseña.");
        if (isNo((await promptLine("¿reintentar? (S/n): ")) || "")) {
          note("cancelado.");
          return 0;
        }
        continue;
      }
      try {
        session = await purchase.login({ email: email.trim(), password });
        break;
      } catch (e) {
        errline((e as Error).message);
        if (isNo((await promptLine("¿reintentar? (S/n): ")) || "")) {
          note("cancelado.");
          return 0;
        }
      }
    }
  }
  note(style.green(`\n✓ hola ${session?.member?.name ?? "socio"}`));

  // 2) ciudad
  const region = await pick("¿De qué ciudad?", await browse.regions(), (r) => r.name);
  if (!region) return 2;
  // 3) película → 4) cine → 5) función (re-elegí si la peli no tiene funciones)
  const movies = await browse.movies(region.id);
  type Show = Awaited<ReturnType<typeof browse.showtimes>>[number];
  let picked: { movie: (typeof movies)[number]; fn: Show } | null = null;
  while (!picked) {
    const m = await pick("¿Qué película?", movies, (x) => x.title);
    if (!m) return 2;
    const showtimes = await browse.showtimes({ movieId: m.id, regionId: region.id });
    if (showtimes.length === 0) {
      note(style.yellow(`"${m.title}" no tiene funciones próximas en ${region.name}. Elegí otra.`));
      continue;
    }
    const cinemas = BrowseCatalog.byCinema(showtimes);
    const cinema = await pick(`¿En qué cine? (${m.title})`, cinemas, (c) => `${c.name}  (${c.showtimes.length} funciones)`);
    if (!cinema) continue;
    const chosen = await pick(
      `¿Qué función en ${cinema.name}?`,
      cinema.showtimes,
      (st) => `${st.date} ${st.time ?? "--:--"}${st.format ? " · " + st.format : ""}`,
    );
    if (!chosen) continue;
    picked = { movie: m, fn: chosen };
  }
  const { movie, fn } = picked;

  // 5) mapa de sala
  const map = await purchase.seatMap(fn, session);
  const allSeats = map.rows.flatMap((r) => r.seats);
  const perSeatPriced = allSeats.some((s) => s.priceCents != null);
  heading(`${movie.title} · ${fn.date} ${fn.time ?? ""} · ${fn.cinemaName}`);
  note(occLine(allSeats.filter((s) => s.available).length, allSeats.length));
  paintSeatMap(map);

  // boleta (solo si la cadena cobra por tipo de boleta, no por silla)
  let fare;
  if (!perSeatPriced) {
    fare = defaultFare(await purchase.fares(fn, session));
    if (!fare) {
      errline("no encontré una boleta comprable para esta función.");
      return 1;
    }
  }

  // 6) elegir butacas (loop) → método de pago → checkout
  for (;;) {
    const raw = (await promptLine("\nbutacas (fila+número ej H12, o varias con coma) o 'q': ")) || "";
    if (raw.toLowerCase() === "q" || !raw.trim()) {
      note("cancelado, no se reservó nada.");
      return 0;
    }
    const { seats, problems } = cmkResolve(raw.split(","), map);
    if (problems.length) {
      errline(problems.join("; "));
      continue;
    }
    paintSeatMap(map, new Set(seats.map((x) => x.label)));
    const total = perSeatPriced
      ? seats.reduce((sum, s) => sum + (s.priceCents ?? 0) / 100, 0)
      : seats.length * ((fare?.priceCents ?? 0) / 100);
    heading("Tu selección");
    note(`butacas: ${style.cyan(seats.map((x) => x.label).join(", "))}`);
    note(`${fare ? fare.name + " · " : ""}total ${style.bold(fmtCOP(total))}${perSeatPriced ? "" : " (+ cargo por servicio)"}`);
    const conf = (await promptLine("¿reservar y generar el pago? crea una orden real (s / N / otra para re-elegir): ")) || "";
    if (conf.toLowerCase() === "n" || conf === "") {
      note("cancelado, no se reservó nada.");
      return 0;
    }
    if (conf.toLowerCase() !== "s" && conf.toLowerCase() !== "si") continue;

    // método de pago (solo si la cadena ofrece elección, ej. banco PSE)
    const methods = purchase.paymentMethods();
    let method;
    if (methods.length) {
      method = (await pick("¿Con qué medio pagás?", methods, (b) => b.name)) ?? undefined;
      if (!method) {
        note("ok, sin medio de pago no genero el link. La orden no se creó.");
        return 0;
      }
    }
    note(style.dim("\nreservando y generando el link de pago… (el CLI no cobra; pagás vos)"));
    try {
      const { order, link } = await purchase.checkout({ session, showtime: fn, movie, regionId: region.id, seats, fare, method });
      openInBrowser(link.url);
      heading("¡Link de pago listo!");
      note(`orden ${order.id} · ${order.seatLabels.join(", ")} · total ${style.bold(fmtCOP(order.total))}${method ? " · " + method.name : ""}`);
      note(`abrí el pago${link.method ? ` (${link.method})` : ""} para completar (el CLI no cobra):`);
      note("  " + style.cyan(link.url));
      note(style.dim("\ntras pagar, las boletas llegan a tu correo."));
      return 0;
    } catch (e) {
      errline((e as Error).message);
      return 1;
    }
  }
}


// Agent-ready purchase verbs (uniform over any PurchasePort): seats · fares · order.
// Non-interactive: credentials come from <CHAIN>_EMAIL / <CHAIN>_PASSWORD env vars
// (or --email/--password). Output is JSON; `order` stops at the payment link — never charges.
async function runPortVerb(p: Provider, verb: string, flags: Record<string, string>, json: boolean): Promise<number> {
  const cmd = `${p.id} ${verb}`;
  const fail = (code: string, message: string) => {
    if (json) emitJson({ ok: false, command: cmd, error: { code, message } });
    else errline(`${cmd}: ${message}`);
    return 1;
  };
  if (!p.purchase) return fail("no-purchase", `${p.name} no tiene compra por API.`);
  const purchase = new PurchaseTickets(p.purchase);

  const env = (k: string) => process.env[`${p.id.toUpperCase()}_${k}`];
  const email = flags.email || env("EMAIL") || "";
  const password = flags.password || env("PASSWORD") || "";

  const login = async () => {
    if (p.auth === "browser-assisted") return purchase.login({ email: "", password: "" });
    // 1) reuse a session saved by `cinesco <chain> login` (no password needed).
    const restored = await purchase.restore();
    if (restored) return restored;
    // 2) fall back to env vars / --email --password.
    if (!email || !password)
      throw new Error(`no hay sesión — corré 'cinesco ${p.id} login', o poné ${p.id.toUpperCase()}_EMAIL y ${p.id.toUpperCase()}_PASSWORD (o --email/--password)`);
    return purchase.login({ email: email.trim(), password });
  };

  const showtime: Showtime = {
    id: flags.session, cinemaId: flags.cinema, hall: flags.hall,
    movieId: flags.movie, date: flags.date ?? "", time: flags.time,
  };

  try {
    if (verb === "seats" || verb === "fares") {
      if (!flags.session || !flags.cinema) return fail("usage", "faltan --cinema y --session");
      const session = await login();
      if (verb === "fares") {
        const fares = await purchase.fares(showtime, session);
        out(json, cmd, fares, [`${p.id} order --cinema ${flags.cinema} --session ${flags.session} --seats <labels>`], () => {
          heading(`${p.name} · tarifas`);
          table(fares.map((f) => ({ code: f.code, boleta: f.name, precio: "$" + (f.priceCents / 100).toLocaleString("es-CO") })),
            [{ key: "code", label: "Código", color: style.cyan }, { key: "boleta", label: "Boleta" }, { key: "precio", label: "Precio" }]);
        });
        return 0;
      }
      const map = await purchase.seatMap(showtime, session);
      const seats = map.rows.flatMap((r) => r.seats);
      const free = seats.filter((x) => x.available).map((x) => ({ label: x.label, priceCents: x.priceCents ?? null, special: !!x.special }));
      out(json, cmd, free, [`${p.id} order --cinema ${flags.cinema} --session ${flags.session} --seats <labels>`], () => {
        heading(`${p.name} · butacas libres`);
        note(occLine(free.length, seats.length));
        paintSeatMap(map);
      });
      return 0;
    }

    if (verb === "order") {
      for (const req of ["cinema", "session", "seats"]) if (!flags[req]) return fail("usage", `falta --${req}`);
      const session = await login();
      const map = await purchase.seatMap(showtime, session);
      const { seats, problems } = cmkResolve((flags.seats || "").split(","), map);
      if (problems.length) return fail("seat-error", problems.join("; "));
      const perSeatPriced = map.rows.some((r) => r.seats.some((x) => x.priceCents != null));
      const fare = perSeatPriced ? undefined : defaultFare(await purchase.fares(showtime, session));
      // --dry-run: price the chosen seats without reserving (no hold, no sale, no link).
      if (flags["dry-run"] !== undefined) {
        const totalCents = perSeatPriced ? seats.reduce((s, x) => s + (x.priceCents ?? 0), 0) : (fare?.priceCents ?? 0) * seats.length;
        const total = Math.round(totalCents / 100);
        out(json, cmd, [{ seats: seats.map((s) => s.label), total, fare: fare?.name ?? "por butaca", willReserve: false, willCharge: false }],
          [`para reservar de verdad, repetí el comando sin --dry-run`], () => {
            heading("Previsualización · no reserva, no cobra");
            note(`${seats.map((s) => s.label).join(", ")} · total $${total.toLocaleString("es-CO")}`);
          });
        return 0;
      }
      const methods = purchase.paymentMethods();
      const method = flags.bank ? methods.find((m) => m.code === flags.bank) : methods[0];
      let title = flags.title ?? "";
      if (!title && flags.region && flags.movie) {
        try { title = (await new BrowseCatalog(p.catalog).movies(flags.region)).find((m) => m.id === flags.movie)?.title ?? ""; } catch { /* best effort */ }
      }
      const movie: Movie = { id: flags.movie ?? "", title };
      // Audit BEFORE the reservation: if the process dies mid-checkout, the
      // pending entry carries what was attempted (identifiers only, no secrets).
      const audit = auditPending(`${p.id}.order`, { cinema: flags.cinema, session: flags.session, hall: flags.hall, movie: flags.movie, region: flags.region, seats: seats.map((s) => s.label) });
      let order, link;
      try {
        ({ order, link } = await purchase.checkout({ session, showtime, movie, regionId: flags.region, seats, fare, method }));
      } catch (e) {
        audit.final("error", { message: (e as Error).message });
        throw e;
      }
      audit.final("ok", { orderId: order.id, total: order.total, seats: order.seatLabels });
      out(json, cmd, [{ orderId: order.id, total: order.total, seats: order.seatLabels, paymentUrl: link.url, method: link.method }],
        [`abrí el link para pagar (el CLI no cobra): ${link.url}`], () => {
          heading("¡Orden lista para pagar!");
          note(`orden ${order.id} · ${order.seatLabels.join(", ")} · total $${order.total.toLocaleString("es-CO")}${link.method ? " · " + link.method : ""}`);
          note("link de pago (el CLI no cobra):");
          note("  " + style.cyan(link.url));
        });
      return 0;
    }

    return fail("usage", `verbo desconocido: ${verb}`);
  } catch (e) {
    return fail("provider-error", (e as Error).message);
  }
}

// Normalise for fuzzy matching: lowercase, strip accents/diacritics.
function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Cross-chain movie search: which chains have `query` in `cityName`, and in which movies.
// Resolves the city per chain (each uses different region ids) and matches titles.
async function searchCmd(query: string, cityName: string, json: boolean): Promise<number> {
  if (!query) {
    if (json) emitJson({ ok: false, command: "search", error: { code: "usage", message: 'usá: cinesco search "<pelicula>" --city <ciudad>' } });
    else errline('usá: cinesco search "<pelicula>" --city <ciudad>');
    return 2;
  }
  const q = norm(query);
  const results = await Promise.all(
    PROVIDERS.map(async (p) => {
      try {
        const catalog = new BrowseCatalog(p.catalog);
        const regions = await catalog.regions();
        const region = cityName
          ? regions.find((r) => norm(r.name) === norm(cityName)) ?? regions.find((r) => norm(r.name).includes(norm(cityName)))
          : undefined;
        if (cityName && !region) return { chain: p.id, chainName: p.name, error: `sin ciudad "${cityName}"` };
        const movies = await catalog.movies(region?.id);
        const matches = movies.filter((m) => norm(m.title).includes(q)).map((m) => ({ id: m.id, title: m.title }));
        return { chain: p.id, chainName: p.name, region: region?.name, regionId: region?.id, matches };
      } catch (e) {
        return { chain: p.id, chainName: p.name, error: (e as Error).message };
      }
    }),
  );
  const hits = results.filter((r) => "matches" in r && (r.matches?.length ?? 0) > 0);
  const steps = hits.flatMap((r: any) => r.matches.map((m: any) => `${r.chain} showtimes ${m.id} ${r.regionId}`));
  if (json) {
    emitJson({ ok: true, command: "search", count: hits.length, data: results, nextSteps: steps.slice(0, 6) });
    return 0;
  }
  heading(`Buscando "${query}"${cityName ? ` en ${cityName}` : ""}`);
  for (const r of results as any[]) {
    if (r.error) { note(`${style.cyan(r.chainName.padEnd(14))} ${style.dim(r.error)}`); continue; }
    if (!r.matches.length) { note(`${style.cyan(r.chainName.padEnd(14))} ${style.dim("sin resultados")}`); continue; }
    note(`${style.cyan(r.chainName.padEnd(14))} ${style.green(r.matches.length + " resultado(s)")}${r.region ? " · " + r.region : ""}`);
    for (const m of r.matches) note(`   ${style.dim(m.id)}  ${m.title}   ${style.dim(`→ cinesco ${r.chain} showtimes ${m.id} ${r.regionId}`)}`);
  }
  return 0;
}

async function main(): Promise<number> {
  const { positionals, flags, json: jsonFlag } = parseArgs(process.argv.slice(2));
  const json = jsonMode(jsonFlag);

  if (flags.version || positionals[0] === "version") {
    if (json) emitJson({ ok: true, command: "version", data: { version: VERSION } });
    else process.stdout.write(VERSION + "\n");
    return 0;
  }
  if (positionals[0] === "logo") {
    logo();
    return 0;
  }
  // --help / -h / help → the documented surface (schema), the thing agents and
  // humans reflexively reach for. Bare invoke keeps its friendly overview below.
  if ((flags.help || positionals[0] === "help" || positionals[0] === "-h") && !getProvider(positionals[0])) {
    schemaCmd(json);
    return 0;
  }
  if (positionals.length === 0) {
    if (json) emitJson({ ok: false, command: "", error: { code: "no-command", message: "usá: cinesco providers | start | <provider> movies | schema" } });
    else {
      // Bare invoke is the first screen — show the same sectioned surface as
      // --help (one source), not a separate hand-kept list that drifts stale.
      logo();
      heading("cinesco");
      renderCommandGroups(SCHEMA_COMMANDS);
      note(style.dim("\ntip: 'cinesco start' hace todo el flujo guiado, o 'cinesco --help' para el detalle."));
    }
    return 2;
  }
  if (positionals[0] === "providers") {
    providersCmd(json);
    return 0;
  }
  if (positionals[0] === "schema") {
    schemaCmd(json);
    return 0;
  }
  if (positionals[0] === "doctor") {
    return doctorCmd(json);
  }
  if (positionals[0] === "skills") {
    return skillsCmd(json);
  }
  if (positionals[0] === "start") {
    return startWizard();
  }
  if (positionals[0] === "search") {
    return searchCmd(positionals.slice(1).join(" ").trim(), flags.city || flags.region || "", json);
  }

  // provider-scoped: cinesco <provider> <verb> ...
  const p = getProvider(positionals[0]);
  if (!p) {
    const msg = `cadena desconocida: "${positionals[0]}". Probá 'cinesco providers'.`;
    if (json) emitJson({ ok: false, command: positionals[0], error: { code: "unknown-provider", message: msg } });
    else errline(msg);
    return 2;
  }
  const verb = positionals[1];

  // Per-chain help: `cinesco <chain>` (no verb), `<chain> --help`, `<chain> help`.
  if (flags.help || !verb || verb === "help") return providerHelp(p, json);

  // pending/cancel are chain-specific: Royal Films (pending + release a hold),
  // Cine Colombia (cancel <orderId>). Anything else is unsupported — say so
  // clearly instead of falling through to "verbo desconocido".
  if ((verb === "pending" || verb === "cancel") && p.id !== "royalfilms" && !(p.id === "cinecolombia" && verb === "cancel")) {
    const msg = `${p.name}: '${verb}' no está disponible (Royal Films: pending + cancel <reservaId>; Cine Colombia: cancel <orderId>).`;
    if (json) emitJson({ ok: false, command: `${p.id} ${verb}`, error: { code: "unsupported", message: msg } });
    else errline(msg);
    return 2;
  }

  // Agent-ready purchase verbs (uniform, --json): seats · fares · order
  // Interactive full-purchase wizard — same one for every chain (over the
  // PurchasePort). Needs a TTY; agents use the seats/fares/order verbs instead.
  if (verb === "buy") {
    if (!p.purchase) return runProviderVerb(p, verb, positionals.slice(2), flags, json);
    return runPurchaseWizard(p);
  }

  if (verb === "seats" || verb === "fares" || verb === "order") {
    return runPortVerb(p, verb, flags, json);
  }

  // Royal Films: poll for a payment (a new sale appearing). Headless — no browser.
  if (p.id === "royalfilms" && (verb === "payment-wait" || verb === "sales" || verb === "pending" || verb === "cancel")) {
    try {
      const { token } = rfRequireToken();
      const doc = rfDocFromToken(token);
      if (!doc) throw new Error("no encontré tu documento en la sesión");
      if (verb === "cancel") {
        // Release a seat hold by its reserva id (frees stuck seats). DELETE /reserve/ticket-office/{id}.
        const id = positionals[2] || flags.id;
        if (!id) throw new UsageError("falta el id de reserva: cinesco royalfilms cancel <reservaId>");
        const audit = auditPending("royalfilms.cancel", { reservaId: Number(id) });
        try { await rfReleaseReserve(Number(id), token); } catch (e) { audit.final("error", { message: (e as Error).message }); throw e; }
        audit.final("ok", { released: Number(id) });
        if (json) emitJson({ ok: true, command: "royalfilms cancel", data: { released: Number(id) } });
        else note(`✓ hold ${id} liberado.`);
        return 0;
      }
      if (verb === "pending") {
        // venta_estado 3 = confirmada/pagada; anything else is in-process. RF only
        // surfaces sales that produced a ticket, so this can be empty even when a
        // pending sale is blocking a purchase (that one clears on expiry, ~10 min).
        const d = await rfApiGet<{ redeemed?: Row[]; unredeemed?: Row[] }>(`/ticket/document/${doc}`, token);
        const all = [...(d.unredeemed ?? []), ...(d.redeemed ?? [])];
        const pend = all.filter((s) => Number(s.venta_estado) !== 3);
        if (json) emitJson({ ok: true, command: "royalfilms pending", count: pend.length, data: pend, nextSteps: pend.map((s) => `royalfilms cancel ${s.venta_id}`) });
        else if (!pend.length) note("no hay ventas en proceso listables. (una venta pendiente que bloquea la compra puede no aparecer acá; se limpia sola al expirar ~10 min)");
        else {
          heading("Royal Films · ventas en proceso");
          table(pend.map((s) => ({ id: s.venta_id, estado: s.venta_estado, fecha: String(s.venta_fecha).slice(0, 10), total: "$" + Number(s.venta_total).toLocaleString("es-CO") })), [
            { key: "id", label: "Venta", color: style.cyan }, { key: "estado", label: "Estado" }, { key: "fecha", label: "Fecha" }, { key: "total", label: "Total" },
          ]);
        }
        return 0;
      }
      if (verb === "sales") {
        const d = await rfApiGet<{ redeemed?: Row[]; unredeemed?: Row[] }>(`/ticket/document/${doc}`, token);
        const all = [...(d.unredeemed ?? []), ...(d.redeemed ?? [])];
        if (json) emitJson({ ok: true, command: "royalfilms sales", count: all.length, data: all });
        else {
          heading("Royal Films · tus compras");
          table(all.slice(0, 15).map((s) => ({ id: s.venta_id, fecha: String(s.venta_fecha).slice(0, 10), total: "$" + Number(s.venta_total).toLocaleString("es-CO"), cine: (s.multicine as Row)?.multicine_nombre })), [
            { key: "id", label: "Venta", color: style.cyan },
            { key: "fecha", label: "Fecha" },
            { key: "total", label: "Total" },
            { key: "cine", label: "Cine", max: 30 },
          ]);
        }
        return 0;
      }
      // payment-wait
      if (!json) note("esperando el pago (aparece una venta nueva)… Ctrl-C para salir");
      const r = await rfWaitPayment(token, doc, (m) => !json && note(m));
      if (json) emitJson({ ok: true, command: "royalfilms payment-wait", data: { outcome: r.outcome, venta: r.venta } });
      else if (r.outcome === "paid") {
        heading("✓ ¡Pago confirmado!");
        note(`venta #${r.venta!.venta_id} · $${Number(r.venta!.venta_total).toLocaleString("es-CO")} · las boletas están en tu cuenta.`);
      } else note(style.yellow("no detecté el pago a tiempo. Revisá 'cinesco royalfilms sales' o tu correo."));
      return 0;
    } catch (e) {
      const msg = (e as Error).message;
      if (json) emitJson({ ok: false, command: `royalfilms ${verb}`, error: { code: "provider-error", message: msg } });
      else errline(msg);
      return 1;
    }
  }

  // Royal Films auth verbs (buy is handled generically above).
  if (p.id === "royalfilms" && (verb === "login" || verb === "status")) {
    if (verb === "status") {
      const s = rfLoadSession();
      const ok = !!s && !rfIsExpired(s);
      if (json) emitJson({ ok: true, command: "royalfilms status", data: ok ? { authenticated: true, user: s!.user } : { authenticated: false } });
      else {
        heading("Royal Films · sesión");
        note(ok ? `autenticado como ${s!.user.correo ?? s!.user.id}` : "no hay sesión — corré 'cinesco royalfilms login'");
      }
      return 0;
    }
    // login
    const promptLine = (await import("../shared/prompt.ts")).promptLine;
    const promptSecret = (await import("../shared/prompt.ts")).promptSecret;
    const email = flags.email || process.env.ROYALFILMS_EMAIL || (await promptLine("correo: ")) || "";
    const password = flags.password || process.env.ROYALFILMS_PASSWORD || (await promptSecret("clave: ")) || "";
    if (!email || !password) {
      const msg = "faltan credenciales (--email/--password, env, o terminal interactiva)";
      if (json) emitJson({ ok: false, command: "royalfilms login", error: { code: "no-credentials", message: msg } });
      else errline(msg);
      return 2;
    }
    try {
      const sess = await rfLogin(email, password);
      if (json) emitJson({ ok: true, command: "royalfilms login", data: { user: sess.user } });
      else note(`sesión iniciada como ${sess.user.correo ?? sess.user.id}`);
      return 0;
    } catch (e) {
      const m = (e as Error).message;
      if (json) emitJson({ ok: false, command: "royalfilms login", error: { code: "login-failed", message: m } });
      else errline(m);
      return 1;
    }
  }

  // Cinemark session (persists the 24h device fingerprint so buy/order reuse it).
  if (p.id === "cinemark" && (verb === "login" || verb === "status")) {
    if (verb === "status") {
      const s = cmkLoadSession();
      const ok = !!s && !cmkExpired(s);
      if (json) emitJson({ ok: true, command: "cinemark status", data: ok ? { authenticated: true, member: s!.member } : { authenticated: false } });
      else { heading("Cinemark · sesión"); note(ok ? `autenticado como ${s!.member.email ?? s!.member.name ?? s!.member.id}` : "no hay sesión — corré 'cinesco cinemark login'"); }
      return 0;
    }
    const { promptLine, promptSecret } = await import("../shared/prompt.ts");
    const email = flags.email || process.env.CINEMARK_EMAIL || (await promptLine("correo: ")) || "";
    const password = flags.password || process.env.CINEMARK_PASSWORD || (await promptSecret("clave: ")) || "";
    if (!email || !password) {
      const msg = "faltan credenciales (--email/--password, CINEMARK_EMAIL/CINEMARK_PASSWORD, o terminal interactiva)";
      if (json) emitJson({ ok: false, command: "cinemark login", error: { code: "no-credentials", message: msg } });
      else errline(msg);
      return 2;
    }
    try {
      const sess = await cmkProvider.purchase!.login({ email: email.trim(), password });
      if (json) emitJson({ ok: true, command: "cinemark login", data: { member: sess.member } });
      else note(`sesión iniciada como ${sess.member?.email ?? sess.member?.name ?? "socio"}`);
      return 0;
    } catch (e) {
      const m = (e as Error).message;
      if (json) emitJson({ ok: false, command: "cinemark login", error: { code: "login-failed", message: m } });
      else errline(m);
      return 1;
    }
  }

  // Cine Colombia session commands (browser-assisted).
  if (p.id === "cinecolombia" && (verb === "token" || verb === "login" || verb === "status" || verb === "whoami")) {
    if (verb === "status" || positionals[2] === "status") {
      const s = loadSession();
      const data = s ? { has: true, member: !!s.memberCookie, exp: s.exp, expired: s.expired } : { has: false };
      if (json) emitJson({ ok: true, command: "cinecolombia status", data });
      else {
        heading("Sesión de Cine Colombia");
        if (!s) note("no hay sesión. Corré 'cinesco cinecolombia token' (navegar) o 'login' (miembro).");
        else {
          note(s.expired ? "expirada — volvé a correr token/login" : `válida, expira ${new Date(s.exp * 1000).toLocaleString()}`);
          note(s.memberCookie ? "sesión de miembro: sí (login)" : "sesión de miembro: no (solo navegación)");
        }
      }
      return 0;
    }
    if (verb === "whoami") {
      try {
        const me = await ccWhoami();
        if (json) emitJson({ ok: true, command: "cinecolombia whoami", data: me });
        else {
          heading("Cine Colombia · tu cuenta");
          note(`${me.name ?? "—"} · ${me.email ?? "—"}`);
          note(`id ${me.id ?? "—"}${me.club ? ` · ${me.club}` : ""}`);
        }
        return 0;
      } catch (e) {
        const msg = (e as Error).message;
        if (json) emitJson({ ok: false, command: "cinecolombia whoami", error: { code: "auth", message: msg } });
        else errline(msg);
        return 1;
      }
    }
    // token = browse-only session; login = member session
    const wantLogin = verb === "login";
    try {
      const r = await acquireSession(wantLogin, (s) => !json && note(s));
      if (json) emitJson({ ok: true, command: `cinecolombia ${verb}`, data: { saved: true, exp: r.exp, loggedIn: r.loggedIn } });
      else {
        heading(wantLogin ? "Sesión de miembro lista" : "Token de navegación guardado");
        note(`expira ${new Date(r.exp * 1000).toLocaleString()}`);
        note(r.loggedIn ? "logueado como miembro ✓" : "solo navegación (para comprar usá 'login')");
      }
      return 0;
    } catch (e) {
      const msg = (e as Error).message;
      if (json) emitJson({ ok: false, command: `cinecolombia ${verb}`, error: { code: "session-failed", message: msg } });
      else errline(`no se pudo: ${msg}`);
      return 1;
    }
  }

  // Cine Colombia: seat availability + prices for a showtime (member session).
  if (p.id === "cinecolombia" && verb === "seatmap") {
    const showtimeId = positionals[2];
    if (!showtimeId) {
      const msg = "falta el showtimeId (sale de 'showtimes' como campo id, ej 6772-11114)";
      if (json) emitJson({ ok: false, command: "cinecolombia seatmap", error: { code: "usage", message: msg } });
      else errline(msg);
      return 2;
    }
    try {
      const s = await ccSeats(showtimeId);
      if (json) emitJson({ ok: true, command: "cinecolombia seatmap", data: s });
      else {
        heading(`Función ${showtimeId}`);
        note(occLine(s.available.length, s.total) + (s.precioDefault ? " · precio $" + s.precioDefault.toLocaleString("es-CO") : ""));
        ccPaint(s.seats);
        note("\nreservar: cinesco cinecolombia reserve <siteId> " + showtimeId + " --seats <seatId,seatId>");
      }
      return 0;
    } catch (e) {
      const msg = (e as Error).message;
      if (json) emitJson({ ok: false, command: "cinecolombia seatmap", error: { code: "provider-error", message: msg } });
      else errline(msg);
      return 1;
    }
  }

  // Cine Colombia: reserve seats (creates a REAL order; dry-run by default).
  if (p.id === "cinecolombia" && verb === "reserve") {
    const siteId = positionals[2];
    const showtimeId = positionals[3];
    const seats = (flags.seats ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!siteId || !showtimeId || seats.length === 0) {
      const msg = "uso: cinesco cinecolombia reserve <siteId> <showtimeId> --seats <seatId,seatId> [--confirm]";
      if (json) emitJson({ ok: false, command: "cinecolombia reserve", error: { code: "usage", message: msg } });
      else errline(msg);
      return 2;
    }
    if (!flags.confirm) {
      const data = { dryRun: true, siteId, showtimeId, seats, wouldSend: { booking: { siteId, bookingMode: "Paid" }, showtime: { seats, tickets: [] } } };
      if (json) emitJson({ ok: true, command: "cinecolombia reserve", data });
      else {
        heading("Reserva Cine Colombia (dry-run)");
        note(`butacas ${seats.join(", ")} en función ${showtimeId} (cine ${siteId})`);
        note(style.yellow("esto NO reservó nada. Agregá --confirm para crear la orden (retiene butacas reales)."));
      }
      return 0;
    }
    try {
      // Writes run through the browser (Cloudflare TLS fingerprinting blocks headless).
      const r = await reserveViaBrowser(siteId, showtimeId, seats, (m) => !json && note(m));
      const payUrl = ccPayUrl();
      if (json) emitJson({ ok: true, command: "cinecolombia reserve", data: { orderId: r.orderId, seats, total: r.total, paymentUrl: payUrl, willCharge: false }, nextSteps: [`open "${payUrl}"`, `cinesco cinecolombia cancel ${r.orderId}`] });
      else {
        heading("Butacas retenidas (Cine Colombia)");
        note(`orden ${r.orderId} · butacas ${seats.join(", ")}${r.total ? " · total $" + r.total.toLocaleString("es-CO") : ""}`);
        note(style.yellow("\nPara pagar: abrí " + style.cyan(payUrl) + " en el navegador (logueado). El CLI no cobra."));
        note(style.dim(`si te arrepentís: cinesco cinecolombia cancel ${r.orderId}`));
      }
      return 0;
    } catch (e) {
      const msg = (e as Error).message;
      if (json) emitJson({ ok: false, command: "cinecolombia reserve", error: { code: "provider-error", message: msg } });
      else errline(msg);
      return 1;
    }
  }

  // Cine Colombia: cancel/release an order.
  if (p.id === "cinecolombia" && verb === "cancel") {
    const orderId = positionals[2];
    if (!orderId) {
      if (json) emitJson({ ok: false, command: "cinecolombia cancel", error: { code: "usage", message: "falta el orderId" } });
      else errline("falta el orderId");
      return 2;
    }
    try {
      await cancelViaBrowser(orderId, (m) => !json && note(m));
      if (json) emitJson({ ok: true, command: "cinecolombia cancel", data: { cancelled: orderId } });
      else note(`orden ${orderId} liberada`);
      return 0;
    } catch (e) {
      const msg = (e as Error).message;
      if (json) emitJson({ ok: false, command: "cinecolombia cancel", error: { code: "provider-error", message: msg } });
      else errline(msg);
      return 1;
    }
  }

  // Cine Colombia: checkout = create the order + generate the payment link (PlacetoPay).
  if (p.id === "cinecolombia" && verb === "checkout") {
    const siteId = positionals[2];
    const showtimeId = positionals[3];
    const seats = (flags.seats ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!siteId || !showtimeId || seats.length === 0) {
      const msg = "uso: cinesco cinecolombia checkout <siteId> <showtimeId> --seats <seatId,seatId>";
      if (json) emitJson({ ok: false, command: "cinecolombia checkout", error: { code: "usage", message: msg } });
      else errline(msg);
      return 2;
    }
    try {
      const co = await checkoutViaBrowser(siteId, showtimeId, seats, (m) => !json && note(m));
      if (!json) openInBrowser(co.paymentUrl);
      let outcome: string | undefined;
      if (flags.wait) {
        if (!json) note("\nesperando el pago (Ctrl-C para salir)…");
        outcome = await ccWaitPayment(co.orderId, (m) => !json && note(m));
      }
      if (json) emitJson({ ok: true, command: "cinecolombia checkout", data: { ...co, willCharge: false, outcome }, nextSteps: [`open "${co.paymentUrl}"`, `cinesco cinecolombia cancel ${co.orderId}`] });
      else {
        heading("Orden lista para pagar");
        note(`orden ${co.orderId}${co.total ? " · total $" + co.total.toLocaleString("es-CO") : ""}`);
        note("link de pago (PlacetoPay), intenté abrirlo:");
        note("  " + style.cyan(co.paymentUrl));
        if (outcome === "paid") note(style.green("\n✓ pago confirmado — las boletas van a tu correo."));
        else if (outcome === "cancelled") note(style.red("\nla orden se canceló/expiró sin pago."));
        else if (outcome === "timeout") note(style.yellow("\nno detecté el pago a tiempo; revisá tu correo o el estado con 'order-status'."));
        else {
          note(style.yellow("el CLI no cobra; completá el pago ahí."));
          note(style.dim(`estado: cinesco cinecolombia order-status ${co.orderId}  ·  cancelar: cinesco cinecolombia cancel ${co.orderId}`));
        }
      }
      return 0;
    } catch (e) {
      const msg = (e as Error).message;
      if (json) emitJson({ ok: false, command: "cinecolombia checkout", error: { code: "provider-error", message: msg } });
      else errline(msg);
      return 1;
    }
  }

  // Cine Colombia: order status (headless; --wait polls until paid/cancelled).
  if (p.id === "cinecolombia" && verb === "order-status") {
    const orderId = positionals[2];
    if (!orderId) {
      if (json) emitJson({ ok: false, command: "cinecolombia order-status", error: { code: "usage", message: "falta el orderId" } });
      else errline("falta el orderId");
      return 2;
    }
    try {
      if (flags.wait) {
        const outcome = await ccWaitPayment(orderId, (m) => !json && note(m));
        if (json) emitJson({ ok: true, command: "cinecolombia order-status", data: { orderId, outcome } });
        else note(outcome === "paid" ? style.green("✓ pagado") : outcome === "cancelled" ? style.red("cancelada/expirada") : style.yellow("sin confirmar (timeout)"));
        return 0;
      }
      const st = await orderStatusViaBrowser(orderId, (m) => !json && note(m));
      if (json) emitJson({ ok: true, command: "cinecolombia order-status", data: { orderId, ...st } });
      else {
        heading(`Orden ${orderId}`);
        if (!st.exists) note("no existe (cancelada o expirada)");
        else note(`${st.paid ? style.green("pagada ✓") : "pendiente de pago"} · estado ${st.status}${st.total ? " · $" + st.total.toLocaleString("es-CO") : ""}`);
      }
      return 0;
    } catch (e) {
      const msg = (e as Error).message;
      if (json) emitJson({ ok: false, command: "cinecolombia order-status", error: { code: "provider-error", message: msg } });
      else errline(msg);
      return 1;
    }
  }

  if (!verb) {
    if (json) emitJson({ ok: false, command: p.id, error: { code: "no-verb", message: "falta verbo: regions | cinemas | movies | showtimes" } });
    else errline(`${p.id}: falta verbo (regions | cinemas | movies | showtimes)`);
    return 2;
  }
  return runProviderVerb(p, verb, positionals.slice(2), flags, json);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    process.stderr.write(`fatal: ${(e as Error).message}\n`);
    process.exitCode = 1;
  });
