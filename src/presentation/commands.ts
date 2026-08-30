import { sleep, launch } from "../shared/proc.ts";
import { apiGet, ApiError } from "../infrastructure/royalfilms/api.ts";
import { heading, table, style, note, logo } from "../shared/output.ts";
import { login, requireToken } from "../infrastructure/royalfilms/auth.ts";
import { loadSession, clearSession, isExpired, sessionFilePath, decodeJwt } from "../infrastructure/royalfilms/session.ts";
import { promptLine, promptSecret, promptSelect } from "../shared/prompt.ts";
import { groupByDate, groupByCinema, funcLabel, funcLabelShort, resolveSeats, type FunctionCell } from "../infrastructure/royalfilms/wizard.ts";
import { paintSeatMap, summarize, seatPrice, resolveSeatsOnMap, type SeatMap, type SeatCell } from "../infrastructure/royalfilms/seatmap.ts";
import { buildReserveBody, reserve, releaseReserve } from "../infrastructure/royalfilms/reserve.ts";
import { auditPending } from "../shared/audit.ts";
import { occLine } from "./occupancy.ts";
import { billingFromToken, buildSessionData, getSessionId, buildCheckoutHtml } from "../infrastructure/royalfilms/checkout.ts";
import { createSale } from "../infrastructure/royalfilms/sale.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

// Resolve a cinema's epayco POS + código from cinemas/city. Returns null if not found.
async function findCinema(
  cityId: number,
  multicineId: number,
  token: string,
): Promise<{ codigo: number; posEpayco: number } | null> {
  const cinemas = await apiGet<Row[]>(`/cinemas/city/${cityId}`, token);
  const c = cinemas.find((x) => Number(x.multicine_id) === multicineId);
  if (!c || c.CompanyInfo == null) return null;
  const company = c.CompanyInfo as Row;
  // empresa_pos_epayco is 0 for many cinemas — that is a valid POS id, not "missing".
  return { codigo: Number(c.multicine_codigo), posEpayco: Number(company.empresa_pos_epayco) };
}

// Open a file in the OS default app (best effort; silent if it fails).
function openInBrowser(path: string): void {
  try {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    launch(cmd, [path]);
  } catch {
    /* best effort */
  }
}

// Create the ePayco session and write the opener HTML. Returns {sessionId, htmlPath, total}.
async function makePaymentSession(
  token: string,
  cinema: { codigo: number; posEpayco: number },
  amount: number,
  invoiceRef: string,
): Promise<{ sessionId: string; htmlPath: string }> {
  const sessionData = buildSessionData({
    posEpayco: cinema.posEpayco,
    multicineCodigo: cinema.codigo,
    amount,
    billing: billingFromToken(token),
    invoiceRef,
  });
  const sessionId = await getSessionId(sessionData, token);
  const htmlPath = join(homedir(), ".royalfilms", `pago-${invoiceRef}.html`);
  writeFileSync(htmlPath, buildCheckoutHtml(sessionId, fmtCOP(amount)), { mode: 0o600 });
  return { sessionId, htmlPath };
}

// A command is noun-verb. `run` returns machine data + count + a human renderer +
// nextSteps (what an agent can run next).

export interface RunResult {
  data: unknown;
  count?: number;
  human: () => void;
  nextSteps?: string[];
}

export interface Command {
  noun: string;
  verb: string;
  args: string[]; // positional arg names, e.g. ["cityId"]
  flags?: { name: string; desc: string }[];
  summary: string;
  run: (pos: string[], flags: Record<string, string>) => Promise<RunResult>;
}

const num = (label: string, v: string): string => {
  if (!/^\d+$/.test(v)) throw new UsageError(`${label} debe ser numérico, recibí "${v}"`);
  return v;
};

export class UsageError extends Error {}

type Row = Record<string, unknown>;
const asRows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : d ? [d as Row] : []);

const fmtCOP = (n?: number): string =>
  typeof n === "number" ? "$" + n.toLocaleString("es-CO") : "—";

// The user's ticket sales (headless read). A new sale appearing = a payment landed.
async function allTicketSales(token: string, doc: string): Promise<Row[]> {
  const d = await apiGet<{ redeemed?: Row[]; unredeemed?: Row[] }>(`/ticket/document/${doc}`, token);
  return [...(d.unredeemed ?? []), ...(d.redeemed ?? [])];
}
async function ticketSaleIds(token: string, doc: string): Promise<Set<number>> {
  return new Set((await allTicketSales(token, doc)).map((s) => Number(s.venta_id)));
}

// Resolve tipo_silla_id -> nombre (Standard, Discapacitados, Covan, ...). Needs a token.
async function fetchTypeNames(token: string): Promise<Map<number, string>> {
  try {
    const types = await apiGet<Row[]>(`/cinemas/halls/chairTypes`, token);
    return new Map(types.map((t) => [Number(t.tipo_silla_id), String(t.tipo_silla_nombre)]));
  } catch {
    return new Map(); // labels are a nicety, not a requirement
  }
}

function tierLines(sum: { tiers: { nombre?: string; tipo_silla_id: number; precio: number; disponibles: number; total: number }[] }): string {
  return sum.tiers
    .map(
      (t) =>
        `  ${style.cyan((t.nombre ?? `tipo ${t.tipo_silla_id}`).padEnd(16))} ${fmtCOP(t.precio).padStart(10)}   ${t.disponibles}/${t.total} libres`,
    )
    .join("\n");
}

// Interactive purchase wizard. Lives here (not in the registry's usual data-command
// shape) because it drives a step-by-step dialogue. TTY-only by design.
export async function runBuyWizard(): Promise<RunResult> {
  if (!process.stdin.isTTY) {
    throw new UsageError(
      "el asistente 'buy' es interactivo y necesita una terminal. Usá los comandos sueltos (seats map, reserve hold) en modo automático.",
    );
  }
  logo();
  const pick = async <T>(title: string, items: T[], label: (t: T) => string): Promise<T> => {
    if (items.length === 0) throw new UsageError("no hay opciones disponibles en este paso");
    const i = await promptSelect(title, items.map(label));
    if (i === null) throw new UsageError("selección cancelada");
    return items[i];
  };

  // 1) país  2) ciudad
  const countries = await apiGet<Row[]>(`/countries`);
  const country = await pick("¿De qué país sos?", countries, (c) => String(c.pais_nombre));
  const cities = (await apiGet<Row[]>(`/cities`)).filter((c) => c.pais_id === country.pais_id);
  const city = await pick("¿De qué ciudad?", cities, (c) => String(c.ciudad_nombre));
  const cityId = Number(city.ciudad_id);

  // 3) película
  const billboard = await apiGet<Row[]>(`/billboard/city/${cityId}`);
  if (billboard.length === 0) throw new UsageError(`no hay cartelera para ${city.ciudad_nombre}`);
  const movieRow = await pick(
    `¿Qué película querés ver en ${city.ciudad_nombre}?`,
    billboard,
    (b) => String((b.pelicula as Row)?.pelicula_nombre_formato ?? ""),
  );
  const movie = movieRow.pelicula as Row;
  const movieId = Number(movie.pelicula_id);

  // 4) fecha  5) función/hora
  const functions = await apiGet<FunctionCell[]>(`/movies/functions/${movieId}/city/${cityId}`);
  if (functions.length === 0) throw new UsageError("esa película no tiene funciones activas");
  const byDate = groupByDate(functions);
  const day = await pick("¿Qué día?", byDate, (d) => `${d.fecha}  (${d.funciones.length} funciones)`);
  const cinemas = groupByCinema(day.funciones);
  const cine = await pick(
    "¿En qué cine?",
    cinemas,
    (c) => `${c.nombre}  (${c.funciones.length} funciones)`,
  );
  const fn = await pick(`¿Qué función en ${cine.nombre}?`, cine.funciones, funcLabelShort);

  // 6) autenticación (inline si hace falta)
  let sess = loadSession();
  if (!sess || isExpired(sess)) {
    note(style.yellow("\nnecesitás iniciar sesión para ver el mapa y reservar."));
    const email = (await promptLine("correo: ")) || "";
    const password = (await promptSecret("clave: ")) || "";
    if (!email || !password) throw new UsageError("faltan credenciales");
    sess = await login(email, password);
  }
  const token = sess.token;

  // 7) mapa
  const map = await apiGet<SeatMap>(
    `/cinemas/halls/id/${fn.funcion_sala_id}/function/id/${fn.funcion_id}/channel/id/1/user/id/${sess.user.id}`,
    token,
  );
  const typeNames = await fetchTypeNames(token);
  const sum = summarize(map, typeNames);
  heading(`${movie.pelicula_nombre_formato}`);
  note(`${fn.funcion_fecha} · ${funcLabel(fn)}`);
  note(occLine(sum.disponibles, sum.total) + ` · máx ${sum.maxPorCompra} por compra`);
  paintSeatMap(map);
  note("\nprecio por tipo:");
  note(tierLines(sum));
  const libres = map.mapa_sala
    .filter((c) => c.silla_disponible)
    .slice(0, 10)
    .map((c) => c.mapa_sala_numero_silla);
  note("\nlibres, por ejemplo: " + libres.join(", "));

  // 8) elegir butacas (varias de una, separadas por coma; con reintento)
  let seats: { id: number; numero: string }[] = [];
  for (;;) {
    const ans = await promptLine("\nbutacas — podés elegir varias separadas por coma (ej: F17,F16,F15) o 'q': ");
    if (ans === null || ans.toLowerCase() === "q") throw new UsageError("compra cancelada");
    const r = resolveSeatsOnMap(ans.split(","), map);
    if (r.problems.length) {
      note(style.red(r.problems.join("; ")));
      continue;
    }
    if (r.seats.length === 0) {
      note("no elegiste ninguna butaca");
      continue;
    }
    if (r.seats.length > sum.maxPorCompra) {
      note(style.red(`máximo ${sum.maxPorCompra} butacas`));
      continue;
    }
    seats = r.seats;
    break;
  }

  // 9) confirmar con el mapa resaltado
  const byId = new Map(map.mapa_sala.map((c) => [c.silla_id, c]));
  const total = seats.reduce((a, s) => a + (seatPrice(byId.get(s.id)!) ?? 0), 0);
  paintSeatMap(map, new Set(seats.map((s) => s.id)));
  note(`\nelegiste: ${seats.map((s) => s.numero).join(", ")} · total ${style.bold(fmtCOP(total))}`);
  const conf = (await promptLine("¿reservar estas butacas? (s/N): ")) || "";
  if (conf.toLowerCase() !== "s" && conf.toLowerCase() !== "si") {
    return { data: { cancelled: true, seats, total }, human() { note("cancelado, no se reservó nada."); } };
  }

  // 10) reservar (real)
  const body = buildReserveBody(fn.funcion_id, fn.funcion_multicine_id, fn.funcion_sala_id, seats);
  const audit = auditPending("buy.reserve", { body, seats });
  let reservaId: number;
  let reserveInfo: import("../infrastructure/royalfilms/sale.ts").ReserveInfo;
  try {
    const res = await reserve(body, token);
    const r = res.reserve;
    reservaId = r.reserva_silla_id;
    reserveInfo = {
      reserva_silla_id: r.reserva_silla_id,
      reserva_silla_funcion: r.reserva_silla_funcion,
      reserva_silla_multicine: r.reserva_silla_multicine,
      reserva_silla_sala: r.reserva_silla_sala,
      reserva_silla_total: total,
    };
    audit.final("ok", { reserva_silla_id: reservaId });
  } catch (e) {
    audit.final("error", { message: (e as Error).message });
    throw e;
  }

  heading("¡Butacas retenidas!");
  note(`${movie.pelicula_nombre_formato} · ${fn.funcion_fecha} ${funcLabel(fn)}`);
  note(`reserva #${reservaId} · ${seats.map((s) => s.numero).join(", ")} · ${style.bold(fmtCOP(total))}`);
  note(`la retención expira en ~${map.configuracion_general.duracion_tiempo_transaccion} min.`);

  // 11) crear la venta (/sale) + generar el link de pago de ePayco (no cobra)
  let payment: { sessionId: string; htmlPath: string } | null = null;
  let ventaId: number | undefined;
  note(style.dim("\nnota: se crea una venta pendiente; si abandonás sin pagar queda EN PROCESO y bloquea nuevas compras hasta que expire."));
  const wantPay = (await promptLine("¿crear la venta y generar el pago de ePayco? (s/N): ")) || "";
  if (wantPay.toLowerCase() === "s" || wantPay.toLowerCase() === "si") {
    const cinema = await findCinema(cityId, fn.funcion_multicine_id, token);
    if (!cinema || Number.isNaN(cinema.posEpayco)) {
      note(style.red("no encontré el POS de ePayco para este cine; no se pudo generar el pago."));
    } else {
      try {
        const sale = await createSale({
          token, session: sess, cityId, multicineId: fn.funcion_multicine_id, movieId,
          fn, map, typeNames, chosen: seats, reserve: reserveInfo, total,
        });
        ventaId = sale.venta_id;
        note(style.green(`venta #${ventaId} creada (pendiente de pago)`));
      } catch (e) {
        const m = (e as Error).message;
        note(style.red(`no se pudo crear la venta: ${m}`));
        if (/pendiente/i.test(m)) note(style.dim("tenés una venta pendiente sin pagar; esperá a que expire o completá ese pago."));
      }
      // el ePayco session referencia la venta por su venta_id (extra1) para que el webhook la confirme
      const invoiceRef = ventaId ? String(ventaId) : `${fn.funcion_id}-${reservaId}`;
      payment = await makePaymentSession(token, cinema, total, invoiceRef);
      openInBrowser(payment.htmlPath);
      note(style.green(`\nsesión de pago creada · sessionId ${payment.sessionId}`));
      note("abrí el formulario de ePayco en el navegador (lo intenté abrir automáticamente):");
      note("  " + style.bold(payment.htmlPath));
      note(style.dim(`  (si no se abrió: open "${payment.htmlPath}")`));
      // Espera el pago: una venta nueva aparece en /ticket/document (headless).
      const doc = String((decodeJwt(token).user as Row)?.usuario_cliente_documento ?? "");
      if (doc) {
        note("\nesperando el pago… (Ctrl-C para salir; no cobra el CLI)");
        const before = await ticketSaleIds(token, doc);
        const deadline = Date.now() + 10 * 60 * 1000;
        let fresh: Row | undefined;
        while (Date.now() < deadline && !fresh) {
          await sleep(5000);
          try {
            fresh = (await allTicketSales(token, doc)).find((s) => !before.has(Number(s.venta_id)));
          } catch {
            /* transient */
          }
        }
        if (fresh) note(style.green(`\n✓ ¡Pago confirmado! venta #${fresh.venta_id} · ${fmtCOP(Number(fresh.venta_total))}. Boletas en tu cuenta.`));
        else note(style.yellow("\nno detecté el pago a tiempo. Revisá 'royalfilms sales' o tu correo."));
      }
    }
  }

  return {
    data: {
      reserva_silla_id: reservaId,
      pelicula: movie.pelicula_nombre_formato,
      funcion: { id: fn.funcion_id, fecha: fn.funcion_fecha, cine: fn.multicine?.multicine_nombre },
      seats,
      total,
      willCharge: false,
      payment,
    },
    nextSteps: payment ? [`open ${payment.htmlPath}`, `reserve release ${reservaId}`] : [`reserve release ${reservaId}`],
    human() {
      note(
        style.yellow(
          "\nNo se cobró nada. El pago solo ocurre si lo confirmás en el formulario de ePayco.",
        ),
      );
      note(style.dim(`si te arrepentís: royalfilms reserve release ${reservaId}`));
    },
  };
}

export const COMMANDS: Command[] = [
  {
    noun: "buy",
    verb: "start",
    args: [],
    summary: "Asistente interactivo: país → ciudad → película → fecha → función → butacas → reserva",
    run: () => runBuyWizard(),
  },
  {
    noun: "auth",
    verb: "login",
    args: [],
    flags: [
      { name: "email", desc: "correo (o env ROYALFILMS_EMAIL, o se pregunta)" },
      { name: "password", desc: "clave (o env ROYALFILMS_PASSWORD, o se pregunta sin eco)" },
    ],
    summary: "Iniciar sesión y guardar el token localmente",
    async run(_pos, flags) {
      const email =
        flags.email || process.env.ROYALFILMS_EMAIL || (await promptLine("correo: ")) || "";
      const password =
        flags.password ||
        process.env.ROYALFILMS_PASSWORD ||
        (await promptSecret("clave: ")) ||
        "";
      if (!email || !password) {
        throw new UsageError(
          "faltan credenciales: pasá --email/--password, definí ROYALFILMS_EMAIL/ROYALFILMS_PASSWORD, o corré en una terminal interactiva",
        );
      }
      const session = await login(email, password);
      return {
        data: { user: session.user, exp: session.exp },
        nextSteps: ["auth status", "seats <funcionId> <salaId>"],
        human() {
          heading("Sesión iniciada");
          note(`hola ${session.user.nombres ?? ""} ${session.user.apellidos ?? ""}`.trim());
          note(`token guardado en ${sessionFilePath()} (solo lectura del dueño)`);
        },
      };
    },
  },
  {
    noun: "auth",
    verb: "status",
    args: [],
    summary: "Ver estado de la sesión",
    async run() {
      const s = loadSession();
      const authenticated = !!s && !isExpired(s);
      return {
        data: authenticated
          ? { authenticated, user: s!.user, exp: s!.exp, expired: false }
          : { authenticated: false, expired: !!s },
        human() {
          heading("Sesión");
          if (!s) note("no hay sesión — corré 'royalfilms auth login'");
          else if (isExpired(s)) note("la sesión expiró — corré 'royalfilms auth login'");
          else {
            note(`autenticado como ${s.user.correo ?? s.user.id}`);
            note(`expira: ${new Date(s.exp * 1000).toLocaleString()}`);
          }
        },
      };
    },
  },
  {
    noun: "auth",
    verb: "logout",
    args: [],
    summary: "Cerrar sesión y borrar el token local",
    async run() {
      const removed = clearSession();
      return {
        data: { removed },
        human() {
          heading("Sesión cerrada");
          note(removed ? "token borrado" : "no había sesión guardada");
        },
      };
    },
  },
  {
    noun: "seats",
    verb: "map",
    args: ["funcionId", "salaId"],
    flags: [{ name: "channel", desc: "canal de venta (default 1)" }],
    summary: "Pintar el mapa de butacas de una función (requiere sesión)",
    async run(pos, flags) {
      const fn = num("funcionId", pos[0]);
      const sala = num("salaId", pos[1]);
      const channel = flags.channel ? num("--channel", flags.channel) : "1";
      const { token, session } = requireToken();
      const path = `/cinemas/halls/id/${sala}/function/id/${fn}/channel/id/${channel}/user/id/${session.user.id}`;
      const map = await apiGet<SeatMap>(path, token);
      if (!map || !map.sala_info || !Array.isArray(map.mapa_sala)) {
        throw new ApiError("bad-seatmap", "la respuesta no tiene la forma esperada del mapa de sala");
      }
      const typeNames = await fetchTypeNames(token);
      const sum = summarize(map, typeNames);
      return {
        data: { summary: sum, mapa_sala: map.mapa_sala, sala_info: map.sala_info },
        count: sum.total,
        nextSteps: [`reserve hold ${fn} ${sala} <multicineId> --seats <sillaIds|etiquetas>`],
        human() {
          heading(`Sala ${sala} · función ${fn}`);
          note(occLine(sum.disponibles, sum.total) + ` · máx ${sum.maxPorCompra} por compra`);
          paintSeatMap(map);
          note("\nprecio por tipo:");
          note(tierLines(sum));
          const libres = map.mapa_sala
            .filter((c) => c.silla_disponible)
            .slice(0, 12)
            .map((c) => `${c.mapa_sala_numero_silla}(${c.silla_id})`);
          note("\nalgunas libres: " + libres.join("  ·  "));
        },
      };
    },
  },
  {
    noun: "reserve",
    verb: "hold",
    args: ["funcionId", "salaId", "multicineId"],
    flags: [
      { name: "seats", desc: "butacas por etiqueta o silla_id, separadas por coma: F17,F16 o 1,2" },
      { name: "confirm", desc: "ejecutar la reserva real (por defecto es dry-run)" },
    ],
    summary: "Retener butacas de una función (dry-run por defecto; retiene inventario real)",
    async run(pos, flags) {
      const fn = Number(num("funcionId", pos[0]));
      const sala = Number(num("salaId", pos[1]));
      const mc = Number(num("multicineId", pos[2]));
      if (!flags.seats) throw new UsageError("faltan butacas: pasá --seats F17,F16 (etiquetas o ids)");
      const { token, session } = requireToken();

      // Validate against the live seat map: seats must exist and be available.
      const map = await apiGet<SeatMap>(
        `/cinemas/halls/id/${sala}/function/id/${fn}/channel/id/1/user/id/${session.user.id}`,
        token,
      );
      const byId = new Map<number, SeatCell>(map.mapa_sala.map((c) => [c.silla_id, c]));
      const resolved = resolveSeatsOnMap(String(flags.seats).split(","), map);
      const seats = resolved.seats;
      if (resolved.problems.length) throw new UsageError(resolved.problems.join("; "));
      if (seats.length === 0) throw new UsageError("no se resolvió ninguna butaca válida");
      if (seats.length > map.configuracion_general.cantidad_max_sillas)
        throw new UsageError(`máximo ${map.configuracion_general.cantidad_max_sillas} butacas por compra`);

      const body = buildReserveBody(fn, mc, sala, seats);
      const total = seats.reduce((a, s) => a + (seatPrice(byId.get(s.id)!) ?? 0), 0);
      const dryRun = !flags.confirm;

      if (dryRun) {
        return {
          data: { dryRun: true, wouldSend: body, seats, total },
          nextSteps: [`reserve hold ${fn} ${sala} ${mc} --seats ${seats.map((s) => s.numero).join(",")} --confirm`],
          human() {
            heading("Reserva (dry-run)");
            note(`butacas: ${seats.map((s) => s.numero).join(", ")} · total ${fmtCOP(total)}`);
            note("esto NO reservó nada. Para retener de verdad, agregá --confirm.");
            note(style.dim("body que se enviaría: " + JSON.stringify(body)));
          },
        };
      }

      // Real mutation: audit before, then call, then audit outcome.
      const audit = auditPending("reserve.hold", { body, seats });
      try {
        const res = await reserve(body, token);
        audit.final("ok", { reserva_silla_id: res.reserve?.reserva_silla_id });
        return {
          data: { dryRun: false, reserve: res.reserve, seats, total, auditId: audit.id },
          nextSteps: [
            `reserve release ${res.reserve.reserva_silla_id}`,
            "completá el pago en https://cinemasroyalfilms.com (el CLI no cobra)",
          ],
          human() {
            heading("Butacas retenidas");
            note(`reserva #${res.reserve.reserva_silla_id} · ${seats.map((s) => s.numero).join(", ")} · ${fmtCOP(total)}`);
            note(`la retención expira en ~${map.configuracion_general.duracion_tiempo_transaccion} min.`);
            note("liberá con: reserve release " + res.reserve.reserva_silla_id);
            note(style.yellow("para pagar, completá la compra en el sitio web — el CLI no procesa el pago."));
          },
        };
      } catch (e) {
        audit.final("error", { message: (e as Error).message });
        throw e;
      }
    },
  },
  {
    noun: "reserve",
    verb: "release",
    args: ["reservaId"],
    summary: "Liberar una reserva propia (deshace un hold)",
    async run(pos) {
      const rid = Number(num("reservaId", pos[0]));
      const { token } = requireToken();
      const audit = auditPending("reserve.release", { reservaId: rid });
      try {
        const res = await releaseReserve(rid, token);
        audit.final("ok");
        return {
          data: { released: rid, result: res },
          human() {
            heading("Reserva liberada");
            note(`reserva #${rid} liberada`);
          },
        };
      } catch (e) {
        audit.final("error", { message: (e as Error).message });
        throw e;
      }
    },
  },
  {
    noun: "checkout",
    verb: "preview",
    args: ["funcionId", "salaId", "multicineId"],
    flags: [{ name: "seats", desc: "silla_ids separados por coma" }],
    summary: "Mostrar el contexto de pago (NO cobra; el pago se completa en el sitio web)",
    async run(pos, flags) {
      const fn = Number(num("funcionId", pos[0]));
      const sala = Number(num("salaId", pos[1]));
      const mc = Number(num("multicineId", pos[2]));
      if (!flags.seats) throw new UsageError("faltan butacas: pasá --seats 1,2,3");
      const ids = String(flags.seats).split(",").map((s) => Number(num("--seats", s.trim())));
      const { token, session } = requireToken();
      const map = await apiGet<SeatMap>(
        `/cinemas/halls/id/${sala}/function/id/${fn}/channel/id/1/user/id/${session.user.id}`,
        token,
      );
      const byId = new Map(map.mapa_sala.map((c) => [c.silla_id, c]));
      const seats = ids.map((id) => {
        const c = byId.get(id);
        if (!c) throw new UsageError(`silla ${id} no existe en esta sala`);
        return { id, numero: c.mapa_sala_numero_silla, precio: seatPrice(c) ?? 0 };
      });
      const total = seats.reduce((a, s) => a + s.precio, 0);
      // Observed /sale body shape (reverse-engineered from the web bundle, UNVERIFIED
      // end-to-end because executing it is a real charge). Shown for transparency only.
      const ventaWouldBe = {
        venta_usuario_id: session.user.id,
        venta_ciudad: session.user.ciudad ?? null,
        venta_total: total,
        venta_canal_venta: 5,
        venta_multicine: mc,
        venta_observaciones: "Venta en pagina web",
        boxOffice: { funcion: fn, sala, sillas: seats.map((s) => ({ id: s.id, numero: s.numero })) },
        _nota: "campos como venta_metodo_pago, venta_usuario_invitado y el detalle de boxOffice no están verificados",
      };
      const payUrl = "https://cinemasroyalfilms.com";
      return {
        data: {
          willCharge: false,
          seats,
          total,
          sale_body_preview: ventaWouldBe,
          pay_at: payUrl,
        },
        nextSteps: [`reserve hold ${fn} ${sala} ${mc} --seats ${seats.map((s) => s.numero).join(",")} --confirm`],
        human() {
          heading("Resumen de compra (preview)");
          note(`butacas: ${seats.map((s) => `${s.numero} ${fmtCOP(s.precio)}`).join(" · ")}`);
          note(`total: ${style.bold(fmtCOP(total))}`);
          note(
            style.yellow(
              "\nEl CLI no procesa el pago (sería un cobro real por ePayco con un payload no verificado).",
            ),
          );
          note(`Para pagar: reservá las butacas (reserve hold ... --confirm) y completá la compra en ${style.cyan(payUrl)} con tu sesión.`);
          note(style.dim("\nbody de venta que el sitio armaría (referencia): " + JSON.stringify(ventaWouldBe)));
        },
      };
    },
  },
  {
    noun: "checkout",
    verb: "session",
    args: ["funcionId", "salaId", "multicineId", "cityId"],
    flags: [{ name: "seats", desc: "butacas por etiqueta o id, separadas por coma" }],
    summary: "Generar la sesión de pago de ePayco y un HTML para abrir el formulario (NO cobra)",
    async run(pos, flags) {
      const fn = Number(num("funcionId", pos[0]));
      const sala = Number(num("salaId", pos[1]));
      const mc = Number(num("multicineId", pos[2]));
      const cityId = Number(num("cityId", pos[3]));
      if (!flags.seats) throw new UsageError("faltan butacas: pasá --seats F17,F16");
      const { token, session } = requireToken();
      const map = await apiGet<SeatMap>(
        `/cinemas/halls/id/${sala}/function/id/${fn}/channel/id/1/user/id/${session.user.id}`,
        token,
      );
      const resolved = resolveSeatsOnMap(String(flags.seats).split(","), map);
      if (resolved.problems.length) throw new UsageError(resolved.problems.join("; "));
      const byId = new Map(map.mapa_sala.map((c) => [c.silla_id, c]));
      const total = resolved.seats.reduce((a, s) => a + (seatPrice(byId.get(s.id)!) ?? 0), 0);
      const cinema = await findCinema(cityId, mc, token);
      if (!cinema || Number.isNaN(cinema.posEpayco))
        throw new ApiError("no-epayco", "no encontré el POS de ePayco para ese cine");
      const invoiceRef = `${fn}-${resolved.seats.map((s) => s.id).join("-")}`;
      const { sessionId, htmlPath } = await makePaymentSession(token, cinema, total, invoiceRef);
      openInBrowser(htmlPath);
      return {
        data: { sessionId, htmlPath, total, willCharge: false, seats: resolved.seats },
        nextSteps: [`open ${htmlPath}`],
        human() {
          heading("Sesión de pago creada");
          note(`butacas: ${resolved.seats.map((s) => s.numero).join(", ")} · total ${style.bold(fmtCOP(total))}`);
          note(`sessionId ePayco: ${style.cyan(sessionId)}`);
          note(`\nintenté abrir el formulario de ePayco en el navegador:`);
          note("  " + style.bold(htmlPath));
          note(style.dim(`  (si no se abrió: open "${htmlPath}")`));
          note(style.yellow("\nNo se creó ninguna orden ni se cobró nada. El pago solo ocurre si lo confirmás en ePayco."));
        },
      };
    },
  },
  {
    noun: "cities",
    verb: "list",
    args: [],
    summary: "Listar todas las ciudades",
    async run() {
      const data = await apiGet<Row[]>(`/cities`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        nextSteps: ["cinemas by-city <cityId>", "billboard by-city <cityId>"],
        human() {
          heading(`Ciudades (${rows.length})`);
          table(rows, [
            { key: "ciudad_id", label: "ID", color: style.cyan },
            { key: "ciudad_nombre", label: "Ciudad" },
            { key: "pais_id", label: "País" },
          ]);
        },
      };
    },
  },
  {
    noun: "countries",
    verb: "list",
    args: [],
    summary: "Listar países",
    async run() {
      const data = await apiGet<Row[]>(`/countries`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        nextSteps: ["identity-types by-country <countryId>"],
        human() {
          heading(`Países (${rows.length})`);
          table(rows, [
            { key: "pais_id", label: "ID", color: style.cyan },
            { key: "pais_nombre", label: "País" },
          ]);
        },
      };
    },
  },
  {
    noun: "city",
    verb: "get",
    args: ["cityId"],
    summary: "Detalle de una ciudad por su ID",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet<Row[]>(`/cities/${city}`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        nextSteps: [`cinemas by-city ${city}`, `billboard by-city ${city}`],
        human() {
          heading(`Ciudad ${city}`);
          if (rows.length === 0) note("(el endpoint devolvió vacío para esta ciudad)");
          else
            table(rows, [
              { key: "ciudad_id", label: "ID", color: style.cyan },
              { key: "ciudad_nombre", label: "Ciudad" },
              { key: "pais_id", label: "País" },
            ]);
        },
      };
    },
  },
  {
    noun: "cinemas",
    verb: "by-city",
    args: ["cityId"],
    summary: "Listar cines (multicines) de una ciudad",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet<Row[]>(`/cinemas/city/${city}`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        nextSteps: [`billboard by-city ${city}`, `billboard by-city ${city} --cinema <multicineId>`],
        human() {
          heading(`Cines en ciudad ${city} (${rows.length})`);
          table(rows, [
            { key: "multicine_id", label: "ID", color: style.cyan },
            { key: "multicine_nombre", label: "Cine" },
            { key: "multicine_direccion", label: "Dirección", max: 48 },
            { key: "multicine_telefono", label: "Teléfono" },
          ]);
        },
      };
    },
  },
  {
    noun: "billboard",
    verb: "by-city",
    args: ["cityId"],
    flags: [{ name: "cinema", desc: "filtrar por multicineId" }],
    summary: "Cartelera (en cartel) de una ciudad, opcionalmente por cine",
    async run(pos, flags) {
      const city = num("cityId", pos[0]);
      const path = flags.cinema
        ? `/billboard/city/${city}/cinema/${num("--cinema", flags.cinema)}`
        : `/billboard/city/${city}`;
      const data = await apiGet<Row[]>(path);
      const rows = asRows(data);
      const flat = rows.map((r) => {
        const p = (r.pelicula ?? {}) as Row;
        return { id: p.pelicula_id, titulo: p.pelicula_nombre_formato, original: p.pelicula_nombre_original };
      });
      return {
        data,
        count: rows.length,
        nextSteps: [`showtimes by-city <peliculaId> ${city}`, `movie by-city <peliculaId> ${city}`],
        human() {
          heading(`Cartelera ciudad ${city}${flags.cinema ? ` · cine ${flags.cinema}` : ""} (${rows.length})`);
          table(flat, [
            { key: "id", label: "ID", color: style.cyan },
            { key: "titulo", label: "Título", max: 50 },
            { key: "original", label: "Original", max: 34 },
          ]);
        },
      };
    },
  },
  {
    noun: "billboard",
    verb: "coming-soon",
    args: ["cityId"],
    summary: "Próximos estrenos de una ciudad",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet<Row[]>(`/billboard/comingSoon/city/${city}`);
      const rows = asRows(data);
      const flat = rows.map((r) => {
        const p = (r.pelicula ?? {}) as Row;
        return { id: p.pelicula_id, titulo: p.pelicula_nombre_formato, original: p.pelicula_nombre_original };
      });
      return {
        data,
        count: rows.length,
        human() {
          heading(`Próximos estrenos ciudad ${city} (${rows.length})`);
          table(flat, [
            { key: "id", label: "ID", color: style.cyan },
            { key: "titulo", label: "Título", max: 50 },
            { key: "original", label: "Original", max: 34 },
          ]);
        },
      };
    },
  },
  {
    noun: "movie",
    verb: "by-city",
    args: ["movieId", "cityId"],
    summary: "Detalle de una película en una ciudad",
    async run(pos) {
      const m = num("movieId", pos[0]);
      const c = num("cityId", pos[1]);
      const data = await apiGet<Row>(`/movies/id/${m}/city/${c}`);
      const p = ((data as Row)?.pelicula ?? data) as Row;
      return {
        data,
        nextSteps: [`showtimes by-city ${m} ${c}`],
        human() {
          heading(`Película ${m} · ciudad ${c}`);
          note(`${p.pelicula_nombre_formato ?? ""}`);
          note(`original: ${p.pelicula_nombre_original ?? "—"}`);
        },
      };
    },
  },
  {
    noun: "movie",
    verb: "by-cinema",
    args: ["movieId", "cinemaId"],
    summary: "Detalle de una película en un cine",
    async run(pos) {
      const m = num("movieId", pos[0]);
      const c = num("cinemaId", pos[1]);
      const data = await apiGet<Row>(`/movies/id/${m}/cinema/${c}`);
      const p = ((data as Row)?.pelicula ?? data) as Row;
      return {
        data,
        human() {
          heading(`Película ${m} · cine ${c}`);
          note(`${p.pelicula_nombre_formato ?? ""}`);
          note(`original: ${p.pelicula_nombre_original ?? "—"}`);
        },
      };
    },
  },
  {
    noun: "showtimes",
    verb: "by-city",
    args: ["movieId", "cityId"],
    summary: "Funciones/horarios de una película en una ciudad",
    async run(pos) {
      const m = num("movieId", pos[0]);
      const c = num("cityId", pos[1]);
      const data = await apiGet<Row[]>(`/movies/functions/${m}/city/${c}`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Funciones película ${m} · ciudad ${c} (${rows.length})`);
          table(rows, [
            { key: "funcion_id", label: "Función", color: style.cyan },
            { key: "funcion_fecha", label: "Fecha" },
            { key: "funcion_multicine_id", label: "Cine" },
            { key: "funcion_sala_id", label: "Sala" },
          ]);
        },
      };
    },
  },
  {
    noun: "services",
    verb: "by-city",
    args: ["cityId"],
    summary: "Formatos/servicios premium (VIP, etc.) de una ciudad",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet<Row[]>(`/service/getFromCity/${city}`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Servicios ciudad ${city} (${rows.length})`);
          table(rows, [
            { key: "servicio_id", label: "ID", color: style.cyan },
            { key: "servicio_nombre", label: "Servicio" },
          ]);
        },
      };
    },
  },
  {
    noun: "banners",
    verb: "by-city",
    args: ["cityId"],
    summary: "Banners publicitarios de una ciudad",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet<Row>(`/advertising/banners/city/${city}`);
      const banners = asRows((data as Row)?.banners ?? data);
      return {
        data,
        count: banners.length,
        human() {
          heading(`Banners ciudad ${city} (${banners.length})`);
          table(banners, [
            { key: "publicidad_banner_id", label: "ID", color: style.cyan },
            { key: "imagen_publicidad_banner_s3", label: "Imagen", max: 50 },
            { key: "orden_publicidad_banner", label: "Orden" },
          ]);
        },
      };
    },
  },
  {
    noun: "popups",
    verb: "by-city",
    args: ["cityId"],
    summary: "Popups publicitarios de una ciudad",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet<Row[]>(`/advertising/popups/city/${city}`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Popups ciudad ${city} (${rows.length})`);
          table(rows, [{ key: "publicidad_popups_id", label: "ID", color: style.cyan }]);
        },
      };
    },
  },
  {
    noun: "promotions",
    verb: "list",
    args: [],
    summary: "Listar promociones",
    async run() {
      const data = await apiGet<Row[]>(`/advertising/promotions`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Promociones (${rows.length})`);
          table(rows, [{ key: "publicidad_promociones_id", label: "ID", color: style.cyan }]);
        },
      };
    },
  },
  {
    noun: "payment-methods",
    verb: "by-city",
    args: ["cityId"],
    summary: "Medios de pago de una ciudad",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet<Row[]>(`/paymentMethods/${city}`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Medios de pago ciudad ${city} (${rows.length})`);
          table(rows, [
            { key: "medio_pago_id", label: "ID", color: style.cyan },
            { key: "medio_pago_descripcion", label: "Medio" },
          ]);
        },
      };
    },
  },
  {
    noun: "identity-types",
    verb: "list",
    args: [],
    summary: "Tipos de documento de identidad (con regex de validación)",
    async run() {
      const data = await apiGet<Row[]>(`/identity/allTypes`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Tipos de identidad (${rows.length})`);
          table(rows, [
            { key: "tipo_identificacion_id", label: "ID", color: style.cyan },
            { key: "tipo_identificacion_nombre", label: "Nombre" },
            { key: "tipo_identificacion_regex", label: "Regex", max: 30 },
          ]);
        },
      };
    },
  },
  {
    noun: "identity-types",
    verb: "by-country",
    args: ["countryId"],
    summary: "Tipos de documento válidos en un país",
    async run(pos) {
      const country = num("countryId", pos[0]);
      const data = await apiGet<Row[]>(`/identity/byCountry/${country}`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Tipos de identidad · país ${country} (${rows.length})`);
          table(rows, [
            { key: "tipo_identificacion_id", label: "ID", color: style.cyan },
            { key: "tipo_identificacion_nombre", label: "Nombre" },
          ]);
        },
      };
    },
  },
  {
    noun: "products",
    verb: "list",
    args: [],
    summary: "Productos del canal/cine por defecto (channel 1, cinema 1)",
    async run() {
      const data = await apiGet<Row[]>(`/products/channel/1/cinema/1`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Productos (${rows.length})`);
          table(rows, [{ key: "producto_id", label: "ID", color: style.cyan }]);
        },
      };
    },
  },
];

export function findCommand(noun: string, verb: string): Command | undefined {
  return COMMANDS.find((c) => c.noun === noun && c.verb === verb);
}
