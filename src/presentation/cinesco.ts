#!/usr/bin/env bun
// Cines Co CLI — one terminal over multiple Colombian cinema chains.
// Ask which chain, then run that provider's adapter. Agent-first: --json auto
// off-TTY, schema command, exit codes 0/1/2, data on stdout / banner on stderr.
import { sleep, launch } from "../shared/proc.ts";
import { resolveDate } from "../shared/dates.ts";
import { PROVIDERS, getProvider } from "../infrastructure/registry.ts";
import type { Provider } from "../domain/ports.ts";
import type { Showtime, Movie } from "../domain/entities.ts";
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
import { runBuyWizard as rfBuyWizard } from "./commands.ts";
import { cinemark as cmkProvider } from "../infrastructure/cinemark/index.ts";
import { PurchaseTickets } from "../application/purchase.ts";
import { BrowseCatalog } from "../application/browse.ts";
import { resolveSeats as cmkResolve, defaultFare } from "../application/seats.ts";
import { paintSeatMap } from "./seatmap.ts";
import { doctorCmd } from "./doctor.ts";
import { skillsCmd } from "./skills.ts";
import { bigText } from "./bigtext.ts";
import { login as rfLogin, requireToken as rfRequireToken } from "../infrastructure/royalfilms/auth.ts";
import { loadSession as rfLoadSession, isExpired as rfIsExpired, decodeJwt as rfDecodeJwt } from "../infrastructure/royalfilms/session.ts";
import { apiGet as rfApiGet } from "../infrastructure/royalfilms/api.ts";

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

function logo(): void {
  if (!process.stdout.isTTY) return;
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
  process.stderr.write(style.dim("   una terminal, todas las salas de cine\n") + strip + "\n");
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

function schemaCmd(json: boolean): void {
  const spec = {
    name: "cinesco",
    version: VERSION,
    schemaVersion: 1,
    providers: PROVIDERS.map((p) => ({ id: p.id, name: p.name, auth: p.auth, capabilities: p.capabilities })),
    commands: [
      { command: "providers", args: [], summary: "Listar las cadenas" },
      { command: "<provider> cinemas", args: ["[region]"], summary: "Cines de una cadena" },
      { command: "<provider> movies", args: ["[region]"], summary: "Cartelera de una cadena" },
      { command: "<provider> showtimes", args: ["movieId", "[region]", "[--date hoy|mañana|viernes]"], summary: "Funciones (filtrable por fecha natural)" },
      { command: "<provider> seats", args: ["--cinema", "--session"], summary: "Butacas libres (datos)" },
      { command: "<provider> fares", args: ["--cinema", "--session"], summary: "Tipos de boleta + precio" },
      { command: "<provider> order", args: ["--cinema", "--session", "--seats", "[--bank]"], summary: "Reservar + link de pago (no cobra)" },
      { command: "search", args: ["<pelicula>", "--city"], summary: "Buscar una peli en las 3 cadenas" },
      { command: "start", args: [], summary: "Asistente: elegí cadena y explorá (interactivo)" },
    ],
    exitCodes: { "0": "ok", "1": "api/network", "2": "usage" },
  };
  if (json) emitJson({ ok: true, command: "schema", data: spec });
  else {
    heading(`cinesco schema v${spec.schemaVersion}`);
    table(spec.commands, [
      { key: "command", label: "Comando", color: style.cyan },
      { key: "summary", label: "Descripción", max: 40 },
    ]);
  }
}

// A browse operation shared by the provider subcommands.
async function runProviderVerb(p: Provider, verb: string, pos: string[], flags: Record<string, string>, json: boolean): Promise<number> {
  const region = pos[0] || flags.region;
  const cmd = `${p.id} ${verb}`;
  try {
    if (verb === "cinemas") {
      const data = await p.catalog.listCinemas(region);
      out(json, cmd, data, ["<provider> movies [region]"], () => {
        heading(`${p.name} · cines${region ? ` (region ${region})` : ""}`);
        table(data, [{ key: "id", label: "ID", color: style.cyan }, { key: "name", label: "Cine" }]);
      });
    } else if (verb === "movies") {
      const data = await p.catalog.listMovies(region);
      out(json, cmd, data, [`${p.id} showtimes <movieId> ${region ?? "[region]"}`], () => {
        heading(`${p.name} · cartelera`);
        table(data, [{ key: "id", label: "ID", color: style.cyan }, { key: "title", label: "Película", max: 50 }]);
      });
    } else if (verb === "showtimes") {
      const movieId = pos[0];
      if (!movieId) throw new UsageError("falta movieId");
      const reg = pos[1] || flags.region;
      let data = await p.catalog.listShowtimes({ movieId, regionId: reg, cinemaId: flags.cinema });
      if (flags.date) {
        const d = resolveDate(flags.date);
        if (!d) throw new UsageError(`fecha no reconocida: "${flags.date}" (usá hoy | mañana | <día de semana> | YYYY-MM-DD)`);
        data = data.filter((s) => s.date === d);
      }
      out(json, cmd, data, [], () => {
        heading(`${p.name} · funciones de ${movieId}`);
        table(data, [
          { key: "id", label: "Función", color: style.cyan },
          { key: "date", label: "Fecha" },
          { key: "time", label: "Hora" },
          { key: "cinemaId", label: "Cine" },
        ]);
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
    if (nextSteps.length) note("\nsiguiente: " + nextSteps.map((s) => style.dim(s)).join("  ·  "));
  }
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

  // 1) login — headless (email+password) retries on a bad password instead of quitting;
  // browser-assisted (Cine Colombia) opens the browser.
  let session;
  const isNo = (s: string) => ["n", "no"].includes(s.trim().toLowerCase());
  if (provider.auth === "browser-assisted") {
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
  note(`${allSeats.filter((s) => s.available).length}/${allSeats.length} butacas libres`);
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
        note(`${free.length}/${seats.length} libres`);
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
      const methods = purchase.paymentMethods();
      const method = flags.bank ? methods.find((m) => m.code === flags.bank) : methods[0];
      let title = flags.title ?? "";
      if (!title && flags.region && flags.movie) {
        try { title = (await new BrowseCatalog(p.catalog).movies(flags.region)).find((m) => m.id === flags.movie)?.title ?? ""; } catch { /* best effort */ }
      }
      const movie: Movie = { id: flags.movie ?? "", title };
      const { order, link } = await purchase.checkout({ session, showtime, movie, regionId: flags.region, seats, fare, method });
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
  if (positionals.length === 0 || flags.help || positionals[0] === "help") {
    if (json) emitJson({ ok: false, command: "", error: { code: "no-command", message: "usá: cinesco providers | start | <provider> movies | schema" } });
    else {
      logo();
      note("\nuso: cinesco <provider> <verb> | cinesco providers | cinesco start\n");
      providersCmd(false);
      note("\nnavegación (ambas): regions · cinemas · movies · showtimes");
      note("royalfilms: " + style.cyan("login · status · buy") + "  (buy = asistente completo)");
      note("cinecolombia: " + style.cyan("login · status · whoami · seatmap · reserve · cancel · checkout"));
      note("otros: providers · doctor · skills · start · schema · logo · --json · --version");
      note(style.dim("\ntip: 'cinesco start' hace todo el flujo guiado (elegí cadena y seguí)."));
    }
    return positionals.length === 0 ? 2 : 0;
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

  // Agent-ready purchase verbs (uniform, --json): seats · fares · order
  if (verb === "seats" || verb === "fares" || verb === "order") {
    return runPortVerb(p, verb, flags, json);
  }

  // Royal Films: poll for a payment (a new sale appearing). Headless — no browser.
  if (p.id === "royalfilms" && (verb === "payment-wait" || verb === "sales")) {
    try {
      const { token } = rfRequireToken();
      const doc = rfDocFromToken(token);
      if (!doc) throw new Error("no encontré tu documento en la sesión");
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

  // Royal Films auth + full-purchase verbs (reuse the royalfilms modules).
  if (p.id === "royalfilms" && (verb === "login" || verb === "status" || verb === "buy")) {
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
    if (verb === "buy") {
      const r = await rfBuyWizard();
      r.human();
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
        note(`${s.available.length}/${s.total} butacas libres${s.isSoldOut ? " (AGOTADA)" : ""} · precio ${s.precioDefault ? "$" + s.precioDefault.toLocaleString("es-CO") : "—"}`);
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
