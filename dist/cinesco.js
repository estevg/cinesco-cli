#!/usr/bin/env node
// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// src/shared/prompt.ts
var exports_prompt = {};
__export(exports_prompt, {
  promptSelect: () => promptSelect,
  promptSecret: () => promptSecret,
  promptLine: () => promptLine
});
import { createInterface } from "node:readline";
async function promptLine(question) {
  if (!process.stdin.isTTY)
    return null;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
async function promptSelect(title, options) {
  if (!process.stdin.isTTY)
    return null;
  process.stderr.write(`
` + title + `
`);
  options.forEach((o, i) => process.stderr.write(`  ${String(i + 1).padStart(2)}. ${o}
`));
  for (;; ) {
    const ans = await promptLine(`elegí [1-${options.length}]: `);
    if (ans === null)
      return null;
    const n = Number(ans);
    if (Number.isInteger(n) && n >= 1 && n <= options.length)
      return n - 1;
    process.stderr.write(`opción inválida
`);
  }
}
async function promptSecret(question) {
  if (!process.stdin.isTTY)
    return null;
  process.stderr.write(question);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let secret = "";
    const onData = (ch) => {
      for (const c of ch) {
        if (c === "\r" || c === `
`) {
          cleanup();
          process.stderr.write(`
`);
          resolve(secret);
          return;
        } else if (c === "\x03") {
          cleanup();
          process.stderr.write(`
`);
          resolve(null);
          return;
        } else if (c === "" || c === "\b") {
          secret = secret.slice(0, -1);
        } else {
          secret += c;
        }
      }
    };
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    stdin.on("data", onData);
  });
}
var init_prompt = () => {};

// src/shared/proc.ts
import { spawn, spawnSync } from "node:child_process";
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function launch(cmd, args) {
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {}
}

// src/domain/errors.ts
class DomainError extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

class AuthError extends DomainError {
  constructor(message = "credenciales inválidas") {
    super(message, "auth");
  }
}

class NotAvailableError extends DomainError {
  constructor(message) {
    super(message, "not-available");
  }
}

class PendingOrderError extends DomainError {
  constructor(message = "ya tenés una compra pendiente sin pagar; esperá a que expire") {
    super(message, "pending-order");
  }
}

// src/infrastructure/royalfilms/wizard.ts
function funcTime(f) {
  const t = f.funcion_hora_inicio || "";
  const m = t.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "--:--";
}
function funcLabel(f) {
  const parts = [
    funcTime(f),
    f.multicine?.multicine_nombre,
    f.sala?.sala_nombre,
    [f.formato?.formato_nombre, f.version?.version_nombre].filter(Boolean).join(" ")
  ].filter(Boolean);
  return parts.join(" · ");
}
function funcLabelShort(f) {
  const parts = [
    funcTime(f),
    f.sala?.sala_nombre,
    [f.formato?.formato_nombre, f.version?.version_nombre].filter(Boolean).join(" ")
  ].filter(Boolean);
  return parts.join(" · ");
}
function groupByCinema(functions) {
  const order = [];
  const map = new Map;
  for (const f of functions) {
    const id = f.funcion_multicine_id;
    if (!map.has(id)) {
      map.set(id, { nombre: f.multicine?.multicine_nombre ?? `Cine ${id}`, funciones: [] });
      order.push(id);
    }
    map.get(id).funciones.push(f);
  }
  return order.map((id) => ({
    multicineId: id,
    nombre: map.get(id).nombre,
    funciones: map.get(id).funciones.sort((a, b) => funcTime(a).localeCompare(funcTime(b)))
  }));
}
function groupByDate(functions) {
  const order = [];
  const map = new Map;
  for (const f of functions) {
    if (!map.has(f.funcion_fecha)) {
      map.set(f.funcion_fecha, []);
      order.push(f.funcion_fecha);
    }
    map.get(f.funcion_fecha).push(f);
  }
  return order.map((fecha) => ({
    fecha,
    funciones: map.get(fecha).sort((a, b) => funcTime(a).localeCompare(funcTime(b)))
  }));
}
function resolveSeats(tokens, cells) {
  const byLabel = new Map(cells.map((c) => [c.mapa_sala_numero_silla.toUpperCase(), c]));
  const byId = new Map(cells.map((c) => [String(c.silla_id), c]));
  const seats = [];
  const problems = [];
  for (const raw of tokens) {
    const tok = raw.trim();
    if (!tok)
      continue;
    const cell = byLabel.get(tok.toUpperCase()) ?? byId.get(tok);
    if (!cell)
      problems.push(`"${tok}" no existe en esta sala`);
    else if (!cell.silla_disponible)
      problems.push(`${cell.mapa_sala_numero_silla} ya está ocupada`);
    else if (seats.some((s) => s.id === cell.silla_id))
      continue;
    else
      seats.push({ id: cell.silla_id, numero: cell.mapa_sala_numero_silla });
  }
  return { seats, problems };
}

// src/infrastructure/royalfilms/catalog.ts
var BASE = "https://cinemasroyalfilms.com/api";
async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json", "User-Agent": "cinesco-cli/0.1.0" } });
  const body = await res.json();
  if (body.status === false)
    throw new DomainError(body.message || `error en ${path}`, "http");
  return body.data ?? [];
}
var royalfilmsCatalog = {
  async listRegions() {
    return (await get(`/cities`)).map((c) => ({ id: String(c.ciudad_id), name: String(c.ciudad_nombre) }));
  },
  async listCinemas(regionId) {
    if (!regionId)
      throw new Error("Royal Films necesita una ciudad (region).");
    return (await get(`/cinemas/city/${regionId}`)).map((c) => ({ id: String(c.multicine_id), name: String(c.multicine_nombre), regionId }));
  },
  async listMovies(regionId) {
    if (!regionId)
      throw new Error("Royal Films necesita una ciudad (region).");
    return (await get(`/billboard/city/${regionId}`)).map((b) => {
      const p = b.pelicula ?? {};
      return { id: String(p.pelicula_id), title: String(p.pelicula_nombre_formato) };
    });
  },
  async listShowtimes({ movieId, regionId }) {
    if (!regionId)
      throw new Error("Royal Films necesita una ciudad (region).");
    return (await get(`/movies/functions/${movieId}/city/${regionId}`)).map((f) => ({
      id: String(f.funcion_id),
      date: String(f.funcion_fecha),
      time: funcTime(f),
      cinemaId: String(f.funcion_multicine_id),
      cinemaName: f.multicine?.multicine_nombre ? String(f.multicine.multicine_nombre) : undefined,
      movieId,
      hall: f.funcion_sala_id != null ? String(f.funcion_sala_id) : undefined,
      format: [f.formato?.formato_nombre, f.version?.version_nombre].filter(Boolean).join(" ") || undefined
    }));
  }
};

// src/infrastructure/royalfilms/api.ts
var BASE2 = "https://cinemasroyalfilms.com/api";
var UA = "royalfilms-cli/0.1.0 (+https://github.com/) node-fetch";

class ApiError extends Error {
  code;
  httpStatus;
  constructor(code, message, httpStatus) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
function authHeaders(token) {
  const h = { Accept: "application/json", "User-Agent": UA };
  if (token)
    h.Authorization = `Bearer ${token}`;
  return h;
}
async function apiGet(path, token) {
  const url = `${BASE2}${path}`;
  let res;
  try {
    res = await fetch(url, { headers: authHeaders(token) });
  } catch (e) {
    throw new ApiError("network", `no se pudo alcanzar ${url}: ${e.message}`);
  }
  const text = await res.text();
  return handle(text, res, path);
}
async function apiPost(path, body, token) {
  const url = `${BASE2}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new ApiError("network", `no se pudo alcanzar ${url}: ${e.message}`);
  }
  const text = await res.text();
  return handle(text, res, path);
}
function handle(text, res, path) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError("bad-response", `respuesta no-JSON de ${path} (HTTP ${res.status})`, res.status);
  }
  if (res.status === 401) {
    throw new ApiError("unauthorized", body.message || "sesión inválida o expirada — corré 'royalfilms auth login'", 401);
  }
  if (body.status === false) {
    throw new ApiError("api-error", body.message || `el endpoint reportó un error`, res.status);
  }
  if (!res.ok) {
    throw new ApiError("http-error", body.message || `HTTP ${res.status}`, res.status);
  }
  return body.data ?? [];
}

// src/infrastructure/royalfilms/session.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
var DIR = join(homedir(), ".royalfilms");
var FILE = join(DIR, "session.json");
function decodeJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3)
    throw new Error("token no es un JWT");
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64 + "=".repeat((4 - b64.length % 4) % 4);
  const json = Buffer.from(pad, "base64").toString("utf8");
  return JSON.parse(json);
}
function userFromToken(token) {
  const payload = decodeJwt(token);
  const u = payload.user ?? {};
  const id = Number(u.usuario_cliente_id);
  if (!id)
    throw new Error("el token no contiene usuario_cliente_id");
  return {
    exp: Number(payload.exp) || 0,
    user: {
      id,
      nombres: u.usuario_cliente_nombres,
      apellidos: u.usuario_cliente_apellidos,
      correo: u.usuario_cliente_correo,
      ciudad: u.usuario_cliente_ciudad != null ? Number(u.usuario_cliente_ciudad) : undefined
    }
  };
}
function saveSession(token) {
  const { user, exp } = userFromToken(token);
  const session = { token, user, exp };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(session, null, 2), { mode: 384 });
  chmodSync(FILE, 384);
  return session;
}
function loadSession() {
  if (!existsSync(FILE))
    return null;
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return null;
  }
}
function isExpired(session, skewSeconds = 30) {
  if (!session.exp)
    return false;
  return Date.now() / 1000 >= session.exp - skewSeconds;
}

// src/infrastructure/royalfilms/auth.ts
async function login(email, password) {
  const token = await apiPost(`/auth/login`, { email, password });
  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new ApiError("bad-login", "el login no devolvió un token válido");
  }
  return saveSession(token);
}

// src/infrastructure/royalfilms/reserve.ts
function buildReserveBody(funcion, multicine, sala, seats) {
  return {
    reserva_silla_funcion: funcion,
    reserva_silla_multicine: multicine,
    reserva_silla_sala: sala,
    sillas_reservadas_id: seats.map((s) => s.id).join(),
    sillas_reservadas_numero: seats.map((s) => s.numero).join(),
    auto_assign_by_type: false,
    chair_type_quantities: []
  };
}
function reserve(body, token) {
  return apiPost(`/reserve/ticket-office`, body, token);
}

// src/infrastructure/royalfilms/sale.ts
function guestJson(session, token) {
  const u = decodeJwt(token).user ?? {};
  return JSON.stringify({
    usuario_nombre: u.usuario_cliente_nombres ?? session.user.nombres ?? "",
    usuario_apellido: u.usuario_cliente_apellidos ?? session.user.apellidos ?? "",
    usuario_documento: String(u.usuario_cliente_documento ?? ""),
    usuario_correo: u.usuario_cliente_correo ?? session.user.correo ?? "",
    usuario_direccion: u.usuario_cliente_direccion ?? "",
    usuario_telefono: String(u.usuario_cliente_telefono ?? ""),
    usuario_tipo_documento: u.usuario_cliente_tipo_documento ?? 2
  });
}
function selectedItems(chosen, map, typeNames) {
  const byId = new Map(map.mapa_sala.map((c) => [c.silla_id, c]));
  return chosen.map((s) => {
    const cell = byId.get(s.id);
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
      price_id: Number(pr?.tipo_silla_precio_detalle_id ?? 0),
      price_name: typeName
    };
  });
}
async function movieBlock(movieId, cityId, token) {
  let m = {};
  try {
    const d = await apiGet(`/movies/id/${movieId}/city/${cityId}`, token);
    m = d?.pelicula ?? d;
  } catch {}
  return {
    pelicula_poster_s3: m.pelicula_poster_s3 ?? null,
    pelicula_titulo: m.pelicula_titulo ?? m.pelicula_nombre_formato ?? "",
    pelicula_duracion: m.duracion ?? m.pelicula_duracion ?? 0,
    pelicula_preventa: m.pelicula_preventa ?? 0,
    pelicula_prestreno: m.pelicula_prestreno ?? 0,
    pelicula_estreno: m.pelicula_estreno ?? 0,
    pelicula_bloqueo_compra_bono: m.pelicula_bloqueo_compra_bono ?? 0,
    pelicula_bloqueo_compra_boleteria_emergencia: m.pelicula_bloqueo_compra_boleteria_emergencia ?? 0
  };
}
async function createSale(opts) {
  const { token, session, cityId, multicineId, movieId, fn, map, typeNames, chosen, reserve: reserve2, total } = opts;
  const items = selectedItems(chosen, map, typeNames);
  const boxOffice = {
    movie: await movieBlock(movieId, cityId, token),
    function: {
      formato_nombre: fn.formato?.formato_nombre ?? "",
      version: fn.version?.version_nombre ?? "",
      funcion_fecha: fn.funcion_fecha,
      funcion_hora_inicio: fn.funcion_hora_inicio,
      funcion_sala: fn.sala?.sala_nombre ?? "",
      multicine_nombre: fn.multicine?.multicine_nombre ?? ""
    },
    reserva_silla_id: reserve2.reserva_silla_id,
    reserva_silla_funcion: reserve2.reserva_silla_funcion,
    reserva_silla_multicine: reserve2.reserva_silla_multicine,
    reserva_silla_sala: reserve2.reserva_silla_sala,
    reserva_silla_total: reserve2.reserva_silla_total,
    pelicula_id: movieId,
    selectedItems: items
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
    venta_metodo_pago: "null",
    venta_usuario_documento: String(decodeJwt(token).user?.usuario_cliente_documento ?? ""),
    venta_usuario_invitado: guestJson(session, token),
    venta_comentarios: "",
    boxOffice,
    candyStand: null,
    supplementary: { products: [] },
    coupon: null,
    promotion: null,
    firstTime: null,
    birthDay: null,
    codes_ids: []
  };
  const res = await apiPost(`/sale`, body, token);
  const ventaId = Number(res?.venta?.venta_id ?? res?.venta_id);
  if (!ventaId)
    throw new Error("la venta no devolvió venta_id");
  return { venta_id: ventaId };
}

// src/infrastructure/royalfilms/checkout.ts
function billingFromToken(token) {
  const u = decodeJwt(token).user ?? {};
  return {
    email: String(u.usuario_cliente_correo ?? ""),
    name: `${u.usuario_cliente_nombres ?? ""} ${u.usuario_cliente_apellidos ?? ""}`.trim(),
    address: String(u.usuario_cliente_direccion ?? ""),
    typeDoc: "CC",
    numberDoc: String(u.usuario_cliente_documento ?? ""),
    callingCode: "+57",
    mobilePhone: String(u.usuario_cliente_telefono ?? "")
  };
}
function buildSessionData(opts) {
  return {
    posicion: opts.posEpayco,
    data: {
      test: false,
      checkout_version: "2",
      name: "Pago Online Royal Films",
      currency: "COP",
      amount: opts.amount,
      description: "Pago Online Royal Films",
      lang: "ES",
      invoice: `${opts.multicineCodigo}-${opts.invoiceRef}`,
      country: "CO",
      response: `https://cinemasroyalfilms.com/confirmacion/${opts.invoiceRef}`,
      extras: { extra1: String(opts.invoiceRef), extra2: opts.billing.email },
      billing: opts.billing
    }
  };
}
function getSessionId(sessionData, token) {
  return apiPost(`/epayco/getSessionId`, { sessionData }, token);
}
function buildCheckoutHtml(sessionId, amountLabel) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Pago Royal Films</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;
    min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{max-width:420px;text-align:center;padding:2rem}
  button{background:#00c389;color:#022;border:0;border-radius:8px;padding:.9rem 1.6rem;
    font-size:1rem;font-weight:600;cursor:pointer}
  .muted{color:#8b93a1;font-size:.9rem;margin-top:1rem}
  code{color:#6cc}
</style>
</head>
<body>
  <div class="card">
    <h2>Royal Films · Pago</h2>
    <p>Total: <strong>${amountLabel}</strong></p>
    <p>Se abrirá el formulario de ePayco. Podés ver y llenar los datos;
       el pago solo se realiza si vos lo confirmás.</p>
    <button id="pay">Abrir formulario de pago</button>
    <p class="muted">sessionId: <code>${sessionId}</code></p>
  </div>
  <script src="https://checkout.epayco.co/checkout-v2.js"></script>
  <script>
    function openCheckout(){
      var handler = ePayco.checkout.configure({ sessionId: "${sessionId}", type: "onpage", test: false });
      handler.open();
    }
    document.getElementById("pay").addEventListener("click", openCheckout);
    // auto-open once the SDK is ready
    window.addEventListener("load", function(){ setTimeout(openCheckout, 400); });
  </script>
</body>
</html>`;
}

// src/shared/output.ts
var stdoutIsTTY = Boolean(process.stdout.isTTY);
var colorEnabled = stdoutIsTTY && !process.env.NO_COLOR;
var ESC = "\x1B[";
function paint(code, s) {
  return colorEnabled ? `${ESC}${code}m${s}${ESC}0m` : s;
}
var style = {
  bold: (s) => paint("1", s),
  dim: (s) => paint("2", s),
  cyan: (s) => paint("36", s),
  green: (s) => paint("32", s),
  yellow: (s) => paint("33", s),
  red: (s) => paint("31", s),
  magenta: (s) => paint("35", s)
};
function visibleWidth(s) {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  return [...stripped].length;
}
function emitJson(env) {
  process.stdout.write(JSON.stringify(env, null, stdoutIsTTY ? 2 : 0) + `
`);
}
var LOGO = [
  "██████╗  ██████╗ ██╗   ██╗ █████╗ ██╗",
  "██╔══██╗██╔═══██╗╚██╗ ██╔╝██╔══██╗██║",
  "██████╔╝██║   ██║ ╚████╔╝ ███████║██║",
  "██╔══██╗██║   ██║  ╚██╔╝  ██╔══██║██║",
  "██║  ██║╚██████╔╝   ██║   ██║  ██║███████╗",
  "╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚══════╝"
];
var STRIP = "▐▌ ".repeat(14).trimEnd();
function logo(toStdout = false) {
  const out = toStdout ? process.stdout : process.stderr;
  if (!toStdout && !stdoutIsTTY)
    return;
  out.write(`
` + style.dim(STRIP) + `
`);
  for (const line of LOGO)
    out.write(style.bold(style.magenta(line)) + `
`);
  out.write(style.cyan("       F I L M S") + style.dim("   ·   cine en tu terminal") + `
`);
  out.write(style.dim(STRIP) + `
`);
}
function heading(text) {
  process.stdout.write(`
` + style.bold(style.cyan(text)) + `
`);
}
function note(text) {
  process.stderr.write(style.dim(text) + `
`);
}
function table(rows, columns) {
  if (rows.length === 0) {
    process.stdout.write(style.dim(`(sin resultados)
`));
    return;
  }
  const cell = (v) => v === null || v === undefined ? "" : String(v);
  const widths = columns.map((c) => {
    const header = visibleWidth(c.label);
    const body = Math.max(0, ...rows.map((r) => {
      let s = cell(r[c.key]);
      if (c.max && s.length > c.max)
        s = s.slice(0, c.max - 1) + "…";
      return visibleWidth(s);
    }));
    return Math.max(header, body);
  });
  const pad = (s, w) => s + " ".repeat(Math.max(0, w - visibleWidth(s)));
  const head = columns.map((c, i) => style.dim(pad(c.label, widths[i]))).join("  ");
  process.stdout.write(head + `
`);
  for (const r of rows) {
    const line = columns.map((c, i) => {
      let s = cell(r[c.key]);
      if (c.max && s.length > c.max)
        s = s.slice(0, c.max - 1) + "…";
      const padded = pad(s, widths[i]);
      return c.color ? c.color(padded) : padded;
    }).join("  ");
    process.stdout.write(line + `
`);
  }
}

// src/infrastructure/royalfilms/seatmap.ts
function seatPrice(c) {
  return c.silla_precio?.[0]?.precio_taquilla_silla?.tipo_silla_precio;
}
function seatTypeId(c) {
  return c.silla_precio?.[0]?.precio_taquilla_silla?.tipo_silla_id ?? c.mapa_sala_tipo_silla;
}
function seatNumber(c) {
  return (c.mapa_sala_numero_silla.match(/\d+/)?.[0] ?? "").padStart(2, "0");
}
var rowLetter = (numero) => numero.match(/^[A-Za-z]+/)?.[0] ?? "?";
function summarize(map, typeNames) {
  const cells = map.mapa_sala;
  const prices = cells.map(seatPrice).filter((p) => typeof p === "number");
  const key = (c) => `${seatTypeId(c)}|${seatPrice(c) ?? 0}`;
  const groups = new Map;
  for (const c of cells) {
    const k = key(c);
    let t = groups.get(k);
    if (!t) {
      t = { tipo_silla_id: seatTypeId(c), nombre: typeNames?.get(seatTypeId(c)), precio: seatPrice(c) ?? 0, total: 0, disponibles: 0 };
      groups.set(k, t);
    }
    t.total += 1;
    if (c.silla_disponible)
      t.disponibles += 1;
  }
  return {
    filas: map.sala_info.sala_filas,
    columnas: map.sala_info.sala_columnas,
    total: cells.length,
    disponibles: cells.filter((c) => c.silla_disponible).length,
    ocupadas: cells.filter((c) => !c.silla_disponible).length,
    maxPorCompra: map.configuracion_general.cantidad_max_sillas,
    precioMin: prices.length ? Math.min(...prices) : undefined,
    precioMax: prices.length ? Math.max(...prices) : undefined,
    tiers: [...groups.values()].sort((a, b) => a.precio - b.precio)
  };
}
function paintSeatMap(map, selectedIds = new Set) {
  const { sala_filas, sala_columnas } = map.sala_info;
  const grid = Array.from({ length: sala_filas }, () => Array(sala_columnas).fill(undefined));
  const rowLabels = Array(sala_filas).fill("");
  for (const c of map.mapa_sala) {
    const x = c.mapa_sala_coordenada_x;
    const y = c.mapa_sala_coordenada_y;
    if (x >= 0 && x < sala_filas && y >= 0 && y < sala_columnas)
      grid[x][y] = c;
    if (!rowLabels[x])
      rowLabels[x] = rowLetter(c.mapa_sala_numero_silla);
  }
  const CELL = 5;
  const gutter = 3;
  const width = sala_columnas * CELL;
  const label = "  P A N T A L L A  ";
  const side = Math.max(2, Math.floor((width - label.length) / 2));
  const bar = "─".repeat(side) + label + "─".repeat(Math.max(2, width - side - label.length));
  process.stdout.write(`
` + " ".repeat(gutter) + style.dim("╭" + bar + "╮") + `
`);
  process.stdout.write(" ".repeat(gutter) + style.dim("╰" + "─".repeat(bar.length) + "╯") + `

`);
  const box = (inner, paint2) => paint2("[" + inner + "]") + " ";
  for (let x = 0;x < sala_filas; x++) {
    const rl = (rowLabels[x] || " ").padEnd(2, " ");
    let line = style.dim(rl) + " ";
    for (let y = 0;y < sala_columnas; y++) {
      const c = grid[x][y];
      if (!c) {
        line += " ".repeat(CELL);
        continue;
      }
      const n = seatNumber(c);
      if (selectedIds.has(c.silla_id))
        line += box(n, (s) => style.cyan(style.bold(s)));
      else if (!c.silla_disponible)
        line += box("··", style.red);
      else if (c.mapa_sala_estado_silla === 2)
        line += box(n, style.magenta);
      else
        line += box(n, style.green);
    }
    process.stdout.write(line.replace(/\s+$/, "") + `
`);
  }
  process.stdout.write(`
` + " ".repeat(gutter) + [
    style.green("[00]") + " libre",
    style.magenta("[00]") + " especial",
    style.red("[··]") + " ocupada",
    style.cyan("[00]") + " elegida"
  ].join("   ") + `
`);
}

// src/infrastructure/royalfilms/purchase.ts
import { writeFileSync as writeFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var cred = (s) => s.credentials;
async function rawSeatMap(hall, showtimeId, userId, token) {
  return apiGet(`/cinemas/halls/id/${hall}/function/id/${showtimeId}/channel/id/1/user/id/${userId}`, token);
}
async function typeNames(token) {
  try {
    const t = await apiGet(`/cinemas/halls/chairTypes`, token);
    return new Map(t.map((x) => [Number(x.tipo_silla_id), String(x.tipo_silla_nombre)]));
  } catch {
    return new Map;
  }
}
async function functionCell(movieId, cityId, showtimeId, token) {
  const fns = await apiGet(`/movies/functions/${movieId}/city/${cityId}`, token);
  const fn = fns.find((f) => String(f.funcion_id) === String(showtimeId));
  if (!fn)
    throw new DomainError("no encontré la función", "not-available");
  return fn;
}
var royalfilmsPurchase = {
  async login({ email, password }) {
    let rf;
    try {
      rf = await login(email, password);
    } catch (e) {
      throw new AuthError(e.message);
    }
    const u = decodeJwt(rf.token).user ?? {};
    const member = {
      id: String(rf.user.id),
      name: [u.usuario_cliente_nombres, u.usuario_cliente_apellidos].filter(Boolean).join(" ") || rf.user.nombres,
      email: rf.user.correo,
      documentId: u.usuario_cliente_documento ? String(u.usuario_cliente_documento) : undefined
    };
    return { provider: "royalfilms", member, credentials: { token: rf.token, rfSession: rf } };
  },
  async getSeatMap(st, session) {
    const { token, rfSession } = cred(session);
    const map = await rawSeatMap(st.hall ?? "", st.id, rfSession.user.id, token);
    const cols = map.sala_info.sala_columnas;
    const rowsByX = new Map;
    for (const cell of map.mapa_sala) {
      const x = cell.mapa_sala_coordenada_x;
      const rowName = cell.mapa_sala_numero_silla.match(/^[A-Za-z]+/)?.[0] ?? "?";
      if (!rowsByX.has(x))
        rowsByX.set(x, { name: rowName, seats: [] });
      rowsByX.get(x).seats.push({
        id: String(cell.silla_id),
        label: cell.mapa_sala_numero_silla,
        row: rowName,
        column: cell.mapa_sala_coordenada_y + 1,
        available: cell.silla_disponible,
        special: cell.mapa_sala_estado_silla !== 1,
        priceCents: (seatPrice(cell) ?? 0) * 100,
        meta: { tipo: cell.mapa_sala_tipo_silla }
      });
    }
    const rows = [...rowsByX.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
    return { cinemaId: st.cinemaId, showtimeId: st.id, columns: cols, rows };
  },
  async listFares() {
    return [];
  },
  paymentMethods: () => [],
  async reserve(input) {
    const { session, showtime: st, movie, regionId, seats } = input;
    const { token, rfSession } = cred(session);
    const cityId = regionId;
    const uid = rfSession.user.id;
    const [map, names, fn] = await Promise.all([
      rawSeatMap(st.hall ?? "", st.id, uid, token),
      typeNames(token),
      functionCell(movie.id, cityId, st.id, token)
    ]);
    const byId = new Map(map.mapa_sala.map((c) => [c.silla_id, c]));
    const chosen = seats.map((s) => ({ id: Number(s.id), numero: s.label }));
    const total = chosen.reduce((sum, c) => sum + (seatPrice(byId.get(c.id)) ?? 0), 0);
    const body = buildReserveBody(fn.funcion_id, fn.funcion_multicine_id, fn.funcion_sala_id, chosen);
    const res = await reserve(body, token);
    const r = res.reserve;
    const sale = await createSale({
      token,
      session: rfSession,
      cityId: Number(cityId),
      multicineId: fn.funcion_multicine_id,
      movieId: Number(movie.id),
      fn,
      map,
      typeNames: names,
      chosen,
      total,
      reserve: { reserva_silla_id: r.reserva_silla_id, reserva_silla_funcion: r.reserva_silla_funcion, reserva_silla_multicine: r.reserva_silla_multicine, reserva_silla_sala: r.reserva_silla_sala, reserva_silla_total: total }
    });
    return { id: String(sale.venta_id), total, seatLabels: seats.map((s) => s.label), meta: { cityId, multicineId: fn.funcion_multicine_id } };
  },
  async pay(input) {
    const { session, order } = input;
    const { token } = cred(session);
    const cityId = String(order.meta?.cityId ?? "");
    const multicineId = Number(order.meta?.multicineId ?? 0);
    const cinemas = await apiGet(`/cinemas/city/${cityId}`, token);
    const c = cinemas.find((x) => Number(x.multicine_id) === multicineId);
    if (!c || c.CompanyInfo == null)
      throw new DomainError("no encontré el POS de ePayco de este cine", "not-available");
    const company = c.CompanyInfo;
    const sessionData = buildSessionData({
      posEpayco: Number(company.empresa_pos_epayco),
      multicineCodigo: Number(c.multicine_codigo),
      amount: order.total,
      billing: billingFromToken(token),
      invoiceRef: order.id
    });
    const sessionId = await getSessionId(sessionData, token);
    const htmlPath = join2(homedir2(), ".royalfilms", `pago-${order.id}.html`);
    writeFileSync2(htmlPath, buildCheckoutHtml(sessionId, "$" + order.total.toLocaleString("es-CO")), { mode: 384 });
    return { provider: "royalfilms", orderId: order.id, url: htmlPath, method: "ePayco" };
  }
};

// src/infrastructure/royalfilms/index.ts
var royalfilms = {
  id: "royalfilms",
  name: "Royal Films",
  country: "Colombia",
  auth: "direct",
  notes: "Login directo email+password → JWT. Todo headless. Pago = ePayco.",
  capabilities: { browse: true, seatmap: true, reserve: true, checkout: true },
  catalog: royalfilmsCatalog,
  purchase: royalfilmsPurchase
};

// src/shared/proc.ts
import { spawn as spawn2, spawnSync as spawnSync2 } from "node:child_process";
import { existsSync as existsSync2 } from "node:fs";
import { join as join3, delimiter } from "node:path";
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
function launch2(cmd, args) {
  try {
    spawn2(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {}
}
function runSync(cmd, args, timeoutMs = 20000) {
  const r = spawnSync2(cmd, args, { timeout: timeoutMs, encoding: "utf8" });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function which(bin) {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir)
      continue;
    for (const ext of exts) {
      const full = join3(dir, bin + ext);
      if (existsSync2(full))
        return full;
    }
  }
  return null;
}

// src/infrastructure/cinecolombia/cinecolombia-token.ts
import { homedir as homedir3 } from "node:os";
import { join as join4 } from "node:path";
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync3, existsSync as existsSync3, readFileSync as readFileSync2, chmodSync as chmodSync2 } from "node:fs";
var DIR2 = join4(homedir3(), ".cinesco");
var FILE2 = join4(DIR2, "cinecolombia-session.json");
var LEGACY_TOKEN_FILE = join4(DIR2, "cinecolombia-token.txt");
var PORT = 9223;
var PROFILE = join4(homedir3(), ".cinesco-chrome");
var MEMBER_COOKIE = "vista-loyalty-member-authentication-token";
function sh(cmd, args, timeoutMs = 20000) {
  return runSync(cmd, args, timeoutMs);
}
function cdpUp() {
  const r = sh("curl", ["-s", "-m", "3", `http://127.0.0.1:${PORT}/json/version`], 5000);
  return r.code === 0 && r.stdout.includes("Browser");
}
function ab(evalJs) {
  const r = sh("agent-browser", ["--cdp", String(PORT), "eval", evalJs], 30000);
  return r.stdout.trim().split(`
`).pop() ?? "";
}
function cdpCookies() {
  const r = sh("agent-browser", ["--cdp", String(PORT), "cookies", "get", "--json"], 15000);
  try {
    const parsed = JSON.parse(r.stdout.trim());
    const arr = parsed?.data?.cookies ?? parsed?.cookies ?? parsed;
    const out = {};
    for (const c of arr)
      out[c.name] = c.value;
    return out;
  } catch {
    return {};
  }
}
function isLoggedIn() {
  const c = cdpCookies();
  if (c[MEMBER_COOKIE])
    return true;
  if (c["vista-loyalty-member-is-authenticated"] === "true")
    return true;
  const hola = ab(`/Hola[,\\s]/.test(document.body.innerText) ? 'yes' : 'no'`).replace(/"/g, "");
  return hola === "yes";
}
function tokenExp(token) {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(p + "=".repeat((4 - p.length % 4) % 4), "base64").toString("utf8");
    return Number(JSON.parse(json).exp) || 0;
  } catch {
    return 0;
  }
}
function loadSession2() {
  if (existsSync3(FILE2)) {
    try {
      const s = JSON.parse(readFileSync2(FILE2, "utf8"));
      return { ...s, expired: s.exp > 0 && Date.now() / 1000 >= s.exp - 30 };
    } catch {}
  }
  const envTok = process.env.CINECO_TOKEN || (existsSync3(LEGACY_TOKEN_FILE) ? readFileSync2(LEGACY_TOKEN_FILE, "utf8").trim() : "");
  if (envTok) {
    const exp = tokenExp(envTok);
    return { appToken: envTok, exp, expired: exp > 0 && Date.now() / 1000 >= exp - 30 };
  }
  return null;
}
function saveSession2(s) {
  mkdirSync2(DIR2, { recursive: true });
  writeFileSync3(FILE2, JSON.stringify(s, null, 2), { mode: 384 });
  chmodSync2(FILE2, 384);
}
async function acquireSession(requireLogin, log) {
  if (sh("which", ["agent-browser"]).code !== 0) {
    throw new Error("necesito 'agent-browser' (npm i -g agent-browser) y Google Chrome.");
  }
  log("abriendo Chrome…");
  launch2("open", ["-na", "Google Chrome", "--args", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "https://www.cinecolombia.com"]);
  let ready = false;
  for (let i = 0;i < 20; i++) {
    await sleep2(2000);
    if (!cdpUp())
      continue;
    const title = ab("document.title").replace(/"/g, "");
    if (title && !/moment|verificaci|verification/i.test(title)) {
      ready = true;
      break;
    }
    log(`  … esperando (Cloudflare)`);
  }
  if (!ready)
    throw new Error("Cine Colombia no cargó (Cloudflare no pasó a tiempo)");
  if (requireLogin) {
    if (isLoggedIn()) {
      log("ya había una sesión iniciada ✓");
    } else {
      log("iniciá sesión en la ventana de Chrome (correo + clave + reCAPTCHA)…");
      let logged = false;
      for (let i = 0;i < 100; i++) {
        await sleep2(3000);
        if (isLoggedIn()) {
          logged = true;
          break;
        }
        if (i % 4 === 0)
          log("  … esperando el login (o cerrá el CLI con Ctrl-C)");
      }
      if (!logged)
        throw new Error("no detecté el login (¿iniciaste sesión y resolviste el reCAPTCHA?). Volvé a intentar.");
      log("login detectado ✓");
    }
  }
  const ck = cdpCookies();
  const appToken = ab(`(async () => { const t = await (await fetch(location.origin)).text(); const m = t.match(/"authToken":"([^"]+)"/); return m ? m[1] : ""; })()`).replace(/^"|"$/g, "");
  const memberCookie = ck[MEMBER_COOKIE] || "";
  const cfClearance = ck["cf_clearance"] || "";
  const userAgent = ab(`navigator.userAgent`).replace(/^"|"$/g, "");
  if (!appToken || appToken.split(".").length !== 3)
    throw new Error("no encontré el token de app en la página");
  const session = {
    appToken,
    memberCookie: memberCookie || undefined,
    cfClearance: cfClearance || undefined,
    userAgent: userAgent || undefined,
    exp: tokenExp(appToken)
  };
  saveSession2(session);
  return { saved: true, exp: session.exp, loggedIn: Boolean(memberCookie), file: FILE2 };
}
function tokenReady() {
  const r = ab(`(async () => { try { const t = await (await fetch('https://www.cinecolombia.com/')).text(); return /"authToken":"[^"]+"/.test(t) ? 'yes' : 'no'; } catch (e) { return 'no'; } })()`);
  return r.replace(/"/g, "") === "yes";
}
var browserWarmedThisRun = false;
async function ensureBrowser(log) {
  if (browserWarmedThisRun && cdpUp() && isLoggedIn())
    return;
  const coldLaunch = !cdpUp();
  if (coldLaunch) {
    log("abriendo Chrome (la compra se hace en el navegador)…");
    launch2("open", ["-na", "Google Chrome", "--args", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "https://www.cinecolombia.com"]);
  }
  let ready = false;
  for (let i = 0;i < 25; i++) {
    await sleep2(2000);
    if (cdpUp() && tokenReady()) {
      ready = true;
      break;
    }
    if (i === 4)
      log("  … esperando a Cloudflare");
  }
  if (!ready)
    throw new Error("Cine Colombia no cargó a tiempo. Volvé a intentar.");
  if (coldLaunch) {
    ab(`(async()=>{try{await cookieStore.delete('${MEMBER_COOKIE}')}catch(e){};try{await cookieStore.delete('vista-loyalty-member-is-authenticated')}catch(e){};return 1})()`);
  }
  if (coldLaunch || !isLoggedIn()) {
    log("iniciá sesión en la ventana de Chrome (correo + clave + reCAPTCHA) para habilitar la compra…");
    let ok = false;
    for (let i = 0;i < 100; i++) {
      await sleep2(3000);
      if (isLoggedIn()) {
        ok = true;
        break;
      }
      if (i % 4 === 0)
        log("  … esperando el login");
    }
    if (!ok)
      throw new Error("no detecté el login. Iniciá sesión en Chrome y reintentá.");
    log("login ok ✓");
  }
  browserWarmedThisRun = true;
}
async function checkoutViaBrowser(siteId, showtimeId, seatIds, log) {
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
  let out;
  try {
    let s = raw.trim();
    if (s.startsWith('"') && s.endsWith('"'))
      s = JSON.parse(s);
    out = JSON.parse(s);
  } catch {
    throw new Error("no pude interpretar la respuesta del checkout");
  }
  if (out.error)
    throw new Error(out.error);
  if (!out.url)
    throw new Error(`no se generó el link de pago (HTTP ${out.status ?? "?"})`);
  return { orderId: out.orderId, total: out.value, paymentUrl: out.url };
}

// src/infrastructure/cinecolombia/cinecolombia.ts
var BASE3 = "https://digital-api.cinecolombia.com/ocapi/v1";
var UA2 = "cinesco-cli/0.1.0";
function authHeaders2(memberRequired = false) {
  const s = loadSession2();
  if (!s || !s.appToken) {
    throw new Error("falta la sesión de Cine Colombia. Corré: cinesco cinecolombia token (navegar) o login (miembro).");
  }
  if (s.expired)
    throw new Error("la sesión de Cine Colombia expiró. Volvé a correr 'cinesco cinecolombia token' o 'login'.");
  const headers = {
    Accept: "application/json",
    "User-Agent": UA2,
    Authorization: `Bearer ${s.appToken}`
  };
  if (s.memberCookie)
    headers.Cookie = `vista-loyalty-member-authentication-token=${s.memberCookie}`;
  else if (memberRequired)
    throw new Error("esto necesita sesión de miembro. Corré: cinesco cinecolombia login");
  return headers;
}
async function get2(path, memberRequired = false) {
  const res = await fetch(`${BASE3}${path}`, { headers: authHeaders2(memberRequired) });
  if (res.status === 401)
    throw new Error("sesión inválida o expirada (401). Corré 'cinesco cinecolombia login'.");
  return await res.json();
}
async function ccSites() {
  const data = await get2(`/sites`);
  return (data.sites ?? []).filter((s) => !/RECARGA/i.test(s.name?.text ?? "")).map((s) => ({
    id: String(s.id),
    name: s.name?.text ?? String(s.id),
    region: (s.contactDetails?.address?.city ?? "").split(",")[0].trim() || undefined
  }));
}
var cinecolombia = {
  id: "cinecolombia",
  name: "Cine Colombia",
  country: "Colombia",
  auth: "browser-assisted",
  notes: "Vista OCAPI. Navegar necesita el token de app; login/compra son browser-assisted (Cloudflare + reCAPTCHA). El pago se completa en el navegador.",
  capabilities: { browse: true, seatmap: true, reserve: true, checkout: true },
  async listRegions() {
    const cines = await ccSites();
    const cities = [...new Set(cines.map((c) => c.region).filter(Boolean))].sort();
    return cities.map((c) => ({ id: c, name: c }));
  },
  async listCinemas(region) {
    const cines = await ccSites();
    return region ? cines.filter((c) => c.region === region) : cines;
  },
  async listMovies() {
    const data = await get2(`/films`);
    return (data.films ?? []).map((f) => ({ id: String(f.id), title: f.title?.text ?? String(f.id) }));
  },
  async listShowtimes({ cinemaId, movieId }) {
    if (!cinemaId)
      throw new Error("Cine Colombia necesita un cinemaId (siteId) para las funciones.");
    const data = await get2(`/showtimes/by-business-date/first?siteIds=${cinemaId}`);
    return (data.showtimes ?? []).filter((s) => !movieId || s.filmId === movieId).map((s) => ({
      id: String(s.id),
      date: s.schedule?.businessDate ?? data.businessDate,
      time: s.schedule?.startsAt ? s.schedule.startsAt.slice(11, 16) : undefined,
      cinemaId,
      movieId: s.filmId,
      hall: s.seatLayoutId
    }));
  }
};
async function whoami() {
  const d = await get2(`/members/current`, true);
  const m = d.member;
  const n = m?.personalDetails?.name;
  return {
    id: m?.id,
    email: m?.credentials?.email,
    name: n ? `${n.givenName ?? ""} ${n.familyName ?? ""}`.trim() : undefined,
    club: d.relatedData?.club?.name?.text
  };
}
async function showtimeSeats(showtimeId) {
  const [avail, prices, detail] = await Promise.all([
    get2(`/showtimes/${showtimeId}/seat-availability`, true),
    get2(`/showtimes/${showtimeId}/ticket-prices`, true),
    get2(`/showtimes/${showtimeId}`, true)
  ]);
  const status = new Map((avail.seatAvailabilities ?? []).map((s) => [s.seatId, s.status]));
  const seats = [];
  const layoutId = detail.showtime?.seatLayoutId;
  if (layoutId) {
    try {
      const lay = await get2(`/seat-layouts/${layoutId}`, true);
      for (const area of lay.seatLayout?.areas ?? []) {
        const areaName = area.name?.text ?? `Zona ${area.number}`;
        for (const r of area.rows ?? []) {
          for (const s of r.seats ?? []) {
            if (!status.has(s.id))
              continue;
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
              status: status.get(s.id) ?? "Unknown"
            });
          }
        }
      }
    } catch {}
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
    precioDefault: def?.price?.valueIncludingTax
  };
}

// src/infrastructure/cinecolombia/catalog.ts
var cinecolombiaCatalog = {
  listRegions: cinecolombia.listRegions ? async () => (await cinecolombia.listRegions()).map((r) => ({ id: r.id, name: r.name })) : undefined,
  async listCinemas(regionId) {
    return (await cinecolombia.listCinemas(regionId)).map((c) => ({ id: c.id, name: c.name, regionId: c.region }));
  },
  async listMovies(regionId) {
    return (await cinecolombia.listMovies(regionId)).map((m) => ({ id: m.id, title: m.title }));
  },
  async listShowtimes(q) {
    const sts = await cinecolombia.listShowtimes({ movieId: q.movieId, region: q.regionId, cinemaId: q.cinemaId });
    return sts.map((s) => ({ id: s.id, date: s.date, time: s.time, cinemaId: s.cinemaId, cinemaName: s.cinemaName, movieId: s.movieId, hall: s.hall, format: s.format }));
  }
};

// src/infrastructure/cinecolombia/purchase.ts
var log = (m) => process.stderr.write(m + `
`);
var cinecolombiaPurchase = {
  async login() {
    let cc = loadSession2();
    if (!cc || cc.expired || !cc.memberCookie) {
      try {
        await acquireSession(true, log);
        cc = loadSession2();
      } catch (e) {
        throw new AuthError(e.message);
      }
    }
    if (!cc?.memberCookie)
      throw new AuthError("no quedó sesión de socio");
    let member = {};
    try {
      const w = await whoami();
      member = { id: w.id ?? "", name: w.name, email: w.email };
    } catch {}
    return { provider: "cinecolombia", member, credentials: { cc } };
  },
  async getSeatMap(st) {
    const info = await showtimeSeats(st.id);
    const priceCents = info.precioDefault != null ? Math.round(info.precioDefault * 100) : undefined;
    const order = [];
    const byRow = new Map;
    let columns = 0;
    for (const s of info.seats) {
      columns = Math.max(columns, s.col);
      if (!byRow.has(s.row)) {
        byRow.set(s.row, { name: s.rowLabel, seats: [] });
        order.push(s.row);
      }
      byRow.get(s.row).seats.push({
        id: s.seatId,
        label: `${s.rowLabel}${s.number}`,
        row: s.rowLabel,
        column: s.col,
        available: s.status === "Available",
        category: s.areaName,
        priceCents
      });
    }
    const rows = order.sort((a, b) => a - b).map((r) => byRow.get(r));
    return { cinemaId: st.cinemaId, showtimeId: st.id, columns, rows };
  },
  async listFares() {
    return [];
  },
  paymentMethods: () => [],
  async reserve(input) {
    const { showtime: st, seats } = input;
    const co = await checkoutViaBrowser(st.cinemaId, st.id, seats.map((s) => s.id), log);
    if (!co.paymentUrl)
      throw new DomainError("no se generó el link de pago", "not-available");
    return { id: co.orderId, total: Math.round(co.total ?? 0), seatLabels: seats.map((s) => s.label), meta: { paymentUrl: co.paymentUrl } };
  },
  async pay(input) {
    const url = String(input.order.meta?.paymentUrl ?? "");
    if (!url)
      throw new DomainError("la orden no tiene link de pago", "not-available");
    return { provider: "cinecolombia", orderId: input.order.id, url, method: "PlacetoPay" };
  }
};

// src/infrastructure/cinecolombia/index.ts
var cinecolombia2 = {
  id: "cinecolombia",
  name: "Cine Colombia",
  country: "Colombia",
  auth: "browser-assisted",
  notes: "Vista OCAPI. Navegar es headless; login/compra van por navegador (Cloudflare + reCAPTCHA). Pago = PlacetoPay.",
  capabilities: { browse: true, seatmap: true, reserve: true, checkout: true },
  catalog: cinecolombiaCatalog,
  purchase: cinecolombiaPurchase
};

// src/infrastructure/http.ts
async function request(url, method, body, opts) {
  const headers = { Accept: "application/json, text/plain, */*", ...opts?.headers };
  if (body !== undefined)
    headers["Content-Type"] ??= "application/json";
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new DomainError(`${method} ${url} → ${res.status}: ${text.slice(0, 200)}`, "http");
  }
  return res;
}
async function getJson(url, opts) {
  return await (await request(url, "GET", undefined, opts)).json();
}
async function postJson(url, body, opts) {
  return await (await request(url, "POST", body, opts)).json();
}
async function postJsonWithHeaders(url, body, opts) {
  const res = await request(url, "POST", body, opts);
  return { data: await res.json(), headers: res.headers };
}

// src/infrastructure/cinemark/client.ts
import { createPublicKey, publicEncrypt, constants as cryptoConstants } from "node:crypto";
var CORE = "https://api.cinemark-core.com";
var WWW = "https://www.cinemark.com.co";
var CO = {
  companyId: "5db771be04daec00076df3f5",
  clientId: "5e2873739eb5e20007f4ba37",
  country: "co",
  connectapitoken: "web-co-token",
  midnightStart: "23:10",
  midnightEnd: "03:00",
  optionalClientId: "111.111.0.130"
};
var UA3 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152 Safari/537.36";
var RANDOM_FP = null;
function randomFingerprint() {
  return RANDOM_FP ??= crypto.randomUUID();
}
function headers(fp, extra) {
  return {
    "User-Agent": UA3,
    connectapitoken: CO.connectapitoken,
    "x-fingerprint-id": fp || randomFingerprint(),
    Origin: WWW,
    Referer: `${WWW}/`,
    ...extra
  };
}
var vista = (p) => `/vista/country/${CO.country}${p}`;
var ordersApi = (p) => `/api/orders/country/${CO.country}${p}`;
var coreGet = (path, fp) => getJson(`${CORE}${path}`, { headers: headers(fp) });
var corePost = (path, body, fp) => postJson(`${CORE}${path}`, body, { headers: headers(fp) });
var wwwGet = (path, fp) => getJson(`${WWW}${path}`, { headers: headers(fp) });
var wwwPost = (path, body, fp) => postJson(`${WWW}${path}`, body, { headers: headers(fp) });
function loyaltyLogin(body) {
  return postJsonWithHeaders(`${CORE}${vista("/loyalty/login")}`, body, { headers: headers() });
}
async function encryptPaymentInfo(fp) {
  const { publicKey } = await wwwGet(`/api/payments/encryption/public-key`, fp);
  const plain = JSON.stringify({ CardNumber: "8888888888888888", CardType: "VOUCHERW", PaymentInfo: "-", PaymentValueCents: 0 });
  const enc = publicEncrypt({ key: createPublicKey(publicKey), padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(plain));
  return enc.toString("base64");
}

// src/infrastructure/cinemark/catalog.ts
function cities() {
  const sel = "ID,Name,PhoneNumber,Address1,Address2,Latitude,Longitude,City,LoyaltyCode";
  return coreGet(vista(`/cities-theaters?$format=json&$select=${sel}`));
}
var cinemarkCatalog = {
  async listRegions() {
    return (await cities()).map((c) => ({ id: c.CitySlug, name: c.Name }));
  },
  async listCinemas(regionId) {
    const cs = await cities();
    const pick = regionId ? cs.filter((c) => c.CitySlug === regionId) : cs;
    return pick.flatMap((c) => (c.Theaters ?? []).map((t) => ({
      id: String(t.CinemaId ?? t.ID),
      name: String(t.Name),
      regionId: c.CitySlug,
      address: t.Address1 ? String(t.Address1) : undefined,
      city: t.City ? String(t.City) : c.Name
    })));
  },
  async listMovies(regionId) {
    if (!regionId)
      throw new Error("Cinemark necesita una ciudad (region).");
    const bb = await coreGet(vista(`/city/${regionId}/movies-billboard-city?companyId=${CO.companyId}`));
    const seen = new Set;
    const out = [];
    for (const cat of ["PremieresBillboard", "Presales"]) {
      for (const m of bb[cat] ?? []) {
        const id = String(m.CorporateFilmId ?? "");
        if (!id || seen.has(id))
          continue;
        seen.add(id);
        out.push({ id, title: String(m.PrettyTitle || m.TitleAlt || m.Title || id), rating: m.RatingAlt || m.Rating || undefined });
      }
    }
    return out;
  },
  async listShowtimes({ movieId, regionId, cinemaId }) {
    if (!regionId)
      throw new Error("Cinemark necesita una ciudad (region).");
    let dates = [];
    try {
      const ds = await coreGet(vista(`/city/${regionId}/dates-session/${movieId}?openingDate=2020-01-01T00:00:00` + `&midnightSessionStart=${CO.midnightStart}&midnightSessionEnd=${CO.midnightEnd}`));
      dates = (ds?.Dates ?? ds ?? []).map((d) => String(d.Date ?? d).slice(0, 10)).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    } catch {}
    if (!dates.length)
      dates = [new Date().toISOString().slice(0, 10)];
    dates = [...new Set(dates)].slice(0, 14);
    const out = [];
    for (const date of dates) {
      const data = await coreGet(vista(`/city/${regionId}/movie/${movieId}?date=${date}&companyId=${CO.companyId}` + `&midnightSessionStart=${CO.midnightStart}&midnightSessionEnd=${CO.midnightEnd}`));
      for (const th of data?.Theater ?? []) {
        if (cinemaId && String(th.CinemaId) !== String(cinemaId))
          continue;
        for (const fmt of th.Format ?? []) {
          const format = [fmt.ScreenTypes, fmt.LangTypes].flat().filter(Boolean).join(" ");
          for (const s of fmt.Sessions ?? []) {
            if (s.IsVisible === false)
              continue;
            out.push({
              id: String(s.SessionId),
              date,
              time: String(s.Showtime ?? "").slice(0, 5) || undefined,
              cinemaId: String(th.CinemaId),
              cinemaName: String(th.Name ?? ""),
              movieId: String(movieId),
              hall: s.ScreenNumber != null ? String(s.ScreenNumber) : undefined,
              format: format || undefined
            });
          }
        }
      }
    }
    return out;
  }
};

// src/infrastructure/cinemark/purchase.ts
var cred2 = (s) => s.credentials;
var PLATFORM = { AppName: "Cinemark Colombia", Os: "Web application", Version: "0.1.0", ClientId: CO.clientId, CompanyId: CO.companyId };
var MEMBER_TIER = /(pro|gold|club|member|socio|mensual|gratis|pase|promo|dbox|premier|amex|2x1)/i;
var PSE_BANKS = [
  { code: "1007", name: "BANCOLOMBIA" },
  { code: "1001", name: "BANCO DE BOGOTA" },
  { code: "1051", name: "DAVIVIENDA" },
  { code: "1013", name: "BBVA COLOMBIA" },
  { code: "1023", name: "BANCO DE OCCIDENTE" },
  { code: "1062", name: "BANCO FALABELLA" },
  { code: "1507", name: "NEQUI" },
  { code: "1551", name: "DAVIPLATA" }
];
function jwtExp(token) {
  try {
    return Number(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp) || 0;
  } catch {
    return 0;
  }
}
function newUserSessionId() {
  return [...crypto.getRandomValues(new Uint8Array(14))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function rand32hex() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function publicIp() {
  try {
    return (await (await fetch("https://api.ipify.org?format=json")).json()).ip;
  } catch {
    return "0.0.0.0";
  }
}
function findGatewayUrl(v) {
  if (typeof v === "string")
    return /^https?:\/\/\S*(pse\.com|boton|payu|placetopay|gateway)/i.test(v) ? v : undefined;
  if (v && typeof v === "object")
    for (const x of Object.values(v)) {
      const f = findGatewayUrl(x);
      if (f)
        return f;
    }
  return;
}
var MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function payDescription(o) {
  const [y, m, d] = String(o.date).split("-").map(Number);
  const [hh, mm] = String(o.time).split(":").map(Number);
  const dt24 = `${MONTHS_ES[m - 1]} ${d} ${y} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const ap = hh < 12 ? "AM" : "PM";
  const dt12 = `${String((hh + 11) % 12 + 1).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${ap}`;
  return [o.cinemaName, o.cinemaId, dt24, o.movieTitle, o.corporateFilmId, dt12, o.seatLabels, o.totalPesos, o.fullName, o.email, o.documentId, "Plat:web", "Versión 0.1.0"].join("_");
}
async function movieBlock2(fp, regionId, cinemaId, movieId) {
  const cities2 = await coreGet(vista(`/cities-theaters?$format=json&$select=ID,Name,Address1,Address2,City`), fp);
  let name = "", address = "", city = "";
  for (const c of cities2)
    for (const t of c.Theaters ?? []) {
      if (String(t.CinemaId ?? t.ID) === String(cinemaId)) {
        name = String(t.Name ?? "");
        address = String(t.Address1 ?? "");
        city = String(t.City ?? c.Name ?? "");
      }
    }
  let rating = "";
  try {
    const bb = await coreGet(vista(`/city/${regionId}/movies-billboard-city?companyId=${CO.companyId}`), fp);
    const m = [...bb.PremieresBillboard ?? [], ...bb.Presales ?? []].find((x) => String(x.CorporateFilmId) === String(movieId));
    rating = String(m?.RatingAlt || m?.Rating || "");
  } catch {}
  return { CinemaName: name, CinemaAddress: address, Rating: rating, RatingDescription: rating, CorporateFilmId: movieId, CinemaCity: city };
}
var cinemarkPurchase = {
  async login({ email, password }) {
    const usid = newUserSessionId();
    const { data: res, headers: headers2 } = await loyaltyLogin({ UserSessionId: usid, ReturnMember: true, MemberLogin: email, MemberPassword: password });
    if (res?.Result !== 0 || !res?.LoyaltySessionToken)
      throw new AuthError(res?.ErrorDescription || "login rechazado (revisá email/contraseña)");
    const fingerprint = headers2.get("x-fingerprint-id") || "";
    if (!fingerprint)
      throw new AuthError("el login no devolvió el fingerprint");
    const m = res.LoyaltyMember ?? res.Member ?? {};
    const member = {
      id: String(m.MemberId ?? m.LoyaltyMemberId ?? ""),
      name: m.FullName ? String(m.FullName) : [m.FirstName, m.LastName].filter(Boolean).join(" ") || undefined,
      email: m.Email ? String(m.Email) : email,
      phone: m.MobilePhone ? String(m.MobilePhone) : m.HomePhone ? String(m.HomePhone) : undefined,
      documentId: m.NationalID ? String(m.NationalID) : undefined
    };
    return { provider: "cinemark", member, credentials: { token: res.LoyaltySessionToken, fingerprint, userSessionId: usid } };
  },
  async getSeatMap(st, _session) {
    const d = await coreGet(vista(`/cinemas/${st.cinemaId}/sessions/${st.id}/seat-plan`));
    const sl = d?.SeatLayoutData ?? {};
    const categories = (sl.AreaCategories ?? []).map((c) => ({ code: String(c.AreaCategoryCode), name: String(c.Name) }));
    const std = mostCommonCategory(sl);
    const rows = [];
    let columns = 0;
    for (const a of sl.Areas ?? []) {
      const areaCat = String(a.AreaCategoryCode ?? "");
      for (const r of a.Rows ?? []) {
        const name = String(r.PhysicalName ?? "");
        const seats = [];
        for (const s of r.Seats ?? []) {
          const col = Number(s.Position?.ColumnIndex ?? 0);
          columns = Math.max(columns, col);
          seats.push({
            id: String(s.Id),
            label: `${name}${s.Id}`,
            row: name,
            column: col,
            available: Number(s.Status) === 0,
            category: areaCat,
            special: areaCat !== std,
            meta: { rowIndex: Number(s.Position?.RowIndex ?? 0), areaNumber: Number(s.Position?.AreaNumber ?? a.Number ?? 1), areaCategoryCode: areaCat }
          });
        }
        if (seats.length)
          rows.push({ name, seats });
      }
    }
    return { cinemaId: st.cinemaId, showtimeId: st.id, columns, rows, categories };
  },
  async listFares(st, session) {
    const { fingerprint, userSessionId } = cred2(session);
    const d = await coreGet(vista(`/cinemas/${st.cinemaId}/sessions/${st.id}/tickets?$format=json&salesChannelFilter=SUNDW&userSessionId=${userSessionId}&companyId=${CO.companyId}`), fingerprint);
    return (d?.Tickets ?? (Array.isArray(d) ? d : [])).filter((t) => !t.IsRedemptionTicket && Number(t.PriceInCents) > 0 && !MEMBER_TIER.test(String(t.DescriptionAlt || t.Description || ""))).map((t) => ({ code: String(t.TicketTypeCode), name: String(t.DescriptionAlt || t.Description || t.TicketTypeCode).trim(), priceCents: Number(t.PriceInCents ?? 0), category: String(t.AreaCategoryCode ?? "") }));
  },
  paymentMethods: () => PSE_BANKS,
  async reserve(input) {
    const { session, showtime: st, movie, regionId, seats, fare } = input;
    const { fingerprint, userSessionId } = cred2(session);
    const m = session.member;
    const movieBlk = await movieBlock2(fingerprint, regionId ?? "", st.cinemaId, movie.id);
    const body = {
      BookingMode: 0,
      OptionalClientId: CO.optionalClientId,
      ProcessOrderValue: true,
      ReturnOrder: true,
      ReturnSeatData: true,
      SkipAutoAllocation: false,
      UserSelectedSeatingSupported: false,
      SelectedSeats: seats.map((s) => ({ AreaCategoryCode: s.meta.areaCategoryCode, AreaNumber: s.meta.areaNumber, RowIndex: s.meta.rowIndex, ColumnIndex: s.column })),
      OptionalClientClass: "WWW",
      Platform: PLATFORM,
      SessionId: Number(st.id),
      CinemaId: Number(st.cinemaId),
      UserSessionId: userSessionId,
      Movie: movieBlk,
      TicketTypes: [{ TicketTypeCode: fare.code, Qty: seats.length }],
      PromotionalCampaigns: [],
      User: { FullName: m.name ?? "", Email: m.email ?? "", Phone: m.phone ?? "", MemberId: m.id, DocumentId: m.documentId ?? "", CustomerType: 2 },
      CalculateGoldDiscount: true,
      CalculateProDiscount: false
    };
    const res = await wwwPost(ordersApi(`/orders/tickets`), body, fingerprint);
    const order = res?.Order;
    const orderId = order?.InternalOrderId;
    if (!orderId)
      throw new PendingOrderError;
    await wwwPost(ordersApi(`/orders`), { UserSessionId: userSessionId, ProcessOrderValue: true, BookingMode: 0, OptionalClientId: CO.optionalClientId }, fingerprint);
    await corePost(vista(`/orders/continue`), { UserSessionId: userSessionId, OptionalClientId: CO.optionalClientId }, fingerprint);
    return { id: orderId, total: Math.round(Number(order.TotalValueCents ?? 0) / 100), seatLabels: seats.map((s) => s.label), meta: { cinemaName: movieBlk.CinemaName } };
  },
  async pay(input) {
    const { session, order, showtime: st, movie, seats, method } = input;
    const { fingerprint, userSessionId } = cred2(session);
    const m = session.member;
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
          buyer: { emailAddress: m.email ?? "" }
        },
        payer: { dniNumber: doc, dniType: "CC", fullName: m.name ?? "", emailAddress: m.email ?? "", contactPhone: m.phone ?? "", merchantPayerId: m.id },
        type: "AUTHORIZATION_AND_CAPTURE",
        deviceSessionId,
        ipAddress: ip,
        cookie: userSessionId,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152 Safari/537.36",
        paymentCountry: "CO",
        memberLevelId: 6,
        extraParameters: { RESPONSE_URL: `https://www.cinemark.com.co/compras/${st.cinemaId}/${st.id}`, PSE_REFERENCE1: ip, PSE_REFERENCE3: doc, USER_TYPE: "N", PSE_REFERENCE2: "CC", FINANCIAL_INSTITUTION_CODE: bank.code },
        paymentMethod: "PSE"
      },
      vista: {
        body: {
          BookingMode: 0,
          CustomerType: 2,
          GenerateConcessionVoucherPrintStream: false,
          OptionalClientClass: "WWW",
          OptionalClientId: CO.optionalClientId,
          OptionalReturnMemberBalances: false,
          PassTypesRequestedForOrder: { IncludeApplePassBook: true, IncludeICal: true },
          PaymentInfo: paymentInfo,
          PerformPayment: false,
          PrintStreamType: 0,
          UseAlternateLanguage: false,
          UserSessionId: userSessionId,
          InternalOrderId: order.id
        }
      }
    };
    await wwwPost(`/api/payments/country/co/pay-order`, body, fingerprint);
    for (let i = 0;i < 20; i++) {
      const d = await wwwGet(`/api/orders/status/${order.id}`, fingerprint);
      const url = findGatewayUrl(d);
      if (url)
        return { provider: "cinemark", orderId: order.id, url, method: bank.name };
      await sleep2(1500);
    }
    throw new NotAvailableError("no obtuve el link de pago a tiempo");
  }
};
function mostCommonCategory(sl) {
  const count = new Map;
  for (const a of sl.Areas ?? [])
    for (const r of a.Rows ?? [])
      for (const s of r.Seats ?? []) {
        const c = String(a.AreaCategoryCode ?? "");
        count.set(c, (count.get(c) ?? 0) + 1);
      }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

// src/infrastructure/cinemark/index.ts
var cinemark = {
  id: "cinemark",
  name: "Cinemark",
  country: "Colombia",
  auth: "direct",
  notes: "Vista via api.cinemark-core.com. Todo headless (browse, login, compra). Pago = PSE/PayU.",
  capabilities: { browse: true, seatmap: true, reserve: true, checkout: true },
  catalog: cinemarkCatalog,
  purchase: cinemarkPurchase
};

// src/infrastructure/registry.ts
var PROVIDERS = [royalfilms, cinecolombia2, cinemark];
function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id);
}

// src/shared/output.ts
var stdoutIsTTY2 = Boolean(process.stdout.isTTY);
var colorEnabled2 = stdoutIsTTY2 && !process.env.NO_COLOR;
var ESC2 = "\x1B[";
function paint2(code, s) {
  return colorEnabled2 ? `${ESC2}${code}m${s}${ESC2}0m` : s;
}
var style2 = {
  bold: (s) => paint2("1", s),
  dim: (s) => paint2("2", s),
  cyan: (s) => paint2("36", s),
  green: (s) => paint2("32", s),
  yellow: (s) => paint2("33", s),
  red: (s) => paint2("31", s),
  magenta: (s) => paint2("35", s)
};
function visibleWidth2(s) {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  return [...stripped].length;
}
function jsonMode(forced) {
  return forced || !stdoutIsTTY2;
}
function emitJson2(env) {
  process.stdout.write(JSON.stringify(env, null, stdoutIsTTY2 ? 2 : 0) + `
`);
}
var STRIP2 = "▐▌ ".repeat(14).trimEnd();
function heading2(text) {
  process.stdout.write(`
` + style2.bold(style2.cyan(text)) + `
`);
}
function note2(text) {
  process.stderr.write(style2.dim(text) + `
`);
}
function errline(text) {
  process.stderr.write(style2.red("error: ") + text + `
`);
}
function table2(rows, columns) {
  if (rows.length === 0) {
    process.stdout.write(style2.dim(`(sin resultados)
`));
    return;
  }
  const cell = (v) => v === null || v === undefined ? "" : String(v);
  const widths = columns.map((c) => {
    const header = visibleWidth2(c.label);
    const body = Math.max(0, ...rows.map((r) => {
      let s = cell(r[c.key]);
      if (c.max && s.length > c.max)
        s = s.slice(0, c.max - 1) + "…";
      return visibleWidth2(s);
    }));
    return Math.max(header, body);
  });
  const pad = (s, w) => s + " ".repeat(Math.max(0, w - visibleWidth2(s)));
  const head = columns.map((c, i) => style2.dim(pad(c.label, widths[i]))).join("  ");
  process.stdout.write(head + `
`);
  for (const r of rows) {
    const line = columns.map((c, i) => {
      let s = cell(r[c.key]);
      if (c.max && s.length > c.max)
        s = s.slice(0, c.max - 1) + "…";
      const padded = pad(s, widths[i]);
      return c.color ? c.color(padded) : padded;
    }).join("  ");
    process.stdout.write(line + `
`);
  }
}

// src/presentation/cinesco.ts
init_prompt();

// src/infrastructure/cinecolombia/cinecolombia-token.ts
import { homedir as homedir4 } from "node:os";
import { join as join5 } from "node:path";
import { mkdirSync as mkdirSync3, writeFileSync as writeFileSync4, existsSync as existsSync4, readFileSync as readFileSync3, chmodSync as chmodSync3 } from "node:fs";
var DIR3 = join5(homedir4(), ".cinesco");
var FILE3 = join5(DIR3, "cinecolombia-session.json");
var LEGACY_TOKEN_FILE2 = join5(DIR3, "cinecolombia-token.txt");
var PORT2 = 9223;
var PROFILE2 = join5(homedir4(), ".cinesco-chrome");
var MEMBER_COOKIE2 = "vista-loyalty-member-authentication-token";
function sh2(cmd, args, timeoutMs = 20000) {
  return runSync(cmd, args, timeoutMs);
}
function cdpUp2() {
  const r = sh2("curl", ["-s", "-m", "3", `http://127.0.0.1:${PORT2}/json/version`], 5000);
  return r.code === 0 && r.stdout.includes("Browser");
}
function ab2(evalJs) {
  const r = sh2("agent-browser", ["--cdp", String(PORT2), "eval", evalJs], 30000);
  return r.stdout.trim().split(`
`).pop() ?? "";
}
function cdpCookies2() {
  const r = sh2("agent-browser", ["--cdp", String(PORT2), "cookies", "get", "--json"], 15000);
  try {
    const parsed = JSON.parse(r.stdout.trim());
    const arr = parsed?.data?.cookies ?? parsed?.cookies ?? parsed;
    const out = {};
    for (const c of arr)
      out[c.name] = c.value;
    return out;
  } catch {
    return {};
  }
}
function isLoggedIn2() {
  const c = cdpCookies2();
  if (c[MEMBER_COOKIE2])
    return true;
  if (c["vista-loyalty-member-is-authenticated"] === "true")
    return true;
  const hola = ab2(`/Hola[,\\s]/.test(document.body.innerText) ? 'yes' : 'no'`).replace(/"/g, "");
  return hola === "yes";
}
function tokenExp2(token) {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(p + "=".repeat((4 - p.length % 4) % 4), "base64").toString("utf8");
    return Number(JSON.parse(json).exp) || 0;
  } catch {
    return 0;
  }
}
function loadSession3() {
  if (existsSync4(FILE3)) {
    try {
      const s = JSON.parse(readFileSync3(FILE3, "utf8"));
      return { ...s, expired: s.exp > 0 && Date.now() / 1000 >= s.exp - 30 };
    } catch {}
  }
  const envTok = process.env.CINECO_TOKEN || (existsSync4(LEGACY_TOKEN_FILE2) ? readFileSync3(LEGACY_TOKEN_FILE2, "utf8").trim() : "");
  if (envTok) {
    const exp = tokenExp2(envTok);
    return { appToken: envTok, exp, expired: exp > 0 && Date.now() / 1000 >= exp - 30 };
  }
  return null;
}
function saveSession3(s) {
  mkdirSync3(DIR3, { recursive: true });
  writeFileSync4(FILE3, JSON.stringify(s, null, 2), { mode: 384 });
  chmodSync3(FILE3, 384);
}
async function acquireSession2(requireLogin, log2) {
  if (sh2("which", ["agent-browser"]).code !== 0) {
    throw new Error("necesito 'agent-browser' (npm i -g agent-browser) y Google Chrome.");
  }
  log2("abriendo Chrome…");
  launch2("open", ["-na", "Google Chrome", "--args", `--remote-debugging-port=${PORT2}`, `--user-data-dir=${PROFILE2}`, "--no-first-run", "--no-default-browser-check", "https://www.cinecolombia.com"]);
  let ready = false;
  for (let i = 0;i < 20; i++) {
    await sleep2(2000);
    if (!cdpUp2())
      continue;
    const title = ab2("document.title").replace(/"/g, "");
    if (title && !/moment|verificaci|verification/i.test(title)) {
      ready = true;
      break;
    }
    log2(`  … esperando (Cloudflare)`);
  }
  if (!ready)
    throw new Error("Cine Colombia no cargó (Cloudflare no pasó a tiempo)");
  if (requireLogin) {
    if (isLoggedIn2()) {
      log2("ya había una sesión iniciada ✓");
    } else {
      log2("iniciá sesión en la ventana de Chrome (correo + clave + reCAPTCHA)…");
      let logged = false;
      for (let i = 0;i < 100; i++) {
        await sleep2(3000);
        if (isLoggedIn2()) {
          logged = true;
          break;
        }
        if (i % 4 === 0)
          log2("  … esperando el login (o cerrá el CLI con Ctrl-C)");
      }
      if (!logged)
        throw new Error("no detecté el login (¿iniciaste sesión y resolviste el reCAPTCHA?). Volvé a intentar.");
      log2("login detectado ✓");
    }
  }
  const ck = cdpCookies2();
  const appToken = ab2(`(async () => { const t = await (await fetch(location.origin)).text(); const m = t.match(/"authToken":"([^"]+)"/); return m ? m[1] : ""; })()`).replace(/^"|"$/g, "");
  const memberCookie = ck[MEMBER_COOKIE2] || "";
  const cfClearance = ck["cf_clearance"] || "";
  const userAgent = ab2(`navigator.userAgent`).replace(/^"|"$/g, "");
  if (!appToken || appToken.split(".").length !== 3)
    throw new Error("no encontré el token de app en la página");
  const session = {
    appToken,
    memberCookie: memberCookie || undefined,
    cfClearance: cfClearance || undefined,
    userAgent: userAgent || undefined,
    exp: tokenExp2(appToken)
  };
  saveSession3(session);
  return { saved: true, exp: session.exp, loggedIn: Boolean(memberCookie), file: FILE3 };
}
async function orderStatusViaBrowser(orderId, log2) {
  await ensureBrowser2(log2);
  const r = parsePageFetch(pageFetch("GET", `/orders/${orderId}`, undefined));
  if (r.status === 404)
    return { exists: false, paid: false };
  if (r.status !== 200)
    throw new Error(`no pude consultar la orden (HTTP ${r.status})`);
  const o = r.body?.order;
  const status = o?.status;
  return {
    exists: true,
    status,
    paid: /completed|confirmed|paid|finaliz/i.test(status ?? ""),
    total: o?.totalPrice?.valueIncludingTax
  };
}
function tokenReady2() {
  const r = ab2(`(async () => { try { const t = await (await fetch('https://www.cinecolombia.com/')).text(); return /"authToken":"[^"]+"/.test(t) ? 'yes' : 'no'; } catch (e) { return 'no'; } })()`);
  return r.replace(/"/g, "") === "yes";
}
var browserWarmedThisRun2 = false;
async function ensureBrowser2(log2) {
  if (browserWarmedThisRun2 && cdpUp2() && isLoggedIn2())
    return;
  const coldLaunch = !cdpUp2();
  if (coldLaunch) {
    log2("abriendo Chrome (la compra se hace en el navegador)…");
    launch2("open", ["-na", "Google Chrome", "--args", `--remote-debugging-port=${PORT2}`, `--user-data-dir=${PROFILE2}`, "--no-first-run", "--no-default-browser-check", "https://www.cinecolombia.com"]);
  }
  let ready = false;
  for (let i = 0;i < 25; i++) {
    await sleep2(2000);
    if (cdpUp2() && tokenReady2()) {
      ready = true;
      break;
    }
    if (i === 4)
      log2("  … esperando a Cloudflare");
  }
  if (!ready)
    throw new Error("Cine Colombia no cargó a tiempo. Volvé a intentar.");
  if (coldLaunch) {
    ab2(`(async()=>{try{await cookieStore.delete('${MEMBER_COOKIE2}')}catch(e){};try{await cookieStore.delete('vista-loyalty-member-is-authenticated')}catch(e){};return 1})()`);
  }
  if (coldLaunch || !isLoggedIn2()) {
    log2("iniciá sesión en la ventana de Chrome (correo + clave + reCAPTCHA) para habilitar la compra…");
    let ok = false;
    for (let i = 0;i < 100; i++) {
      await sleep2(3000);
      if (isLoggedIn2()) {
        ok = true;
        break;
      }
      if (i % 4 === 0)
        log2("  … esperando el login");
    }
    if (!ok)
      throw new Error("no detecté el login. Iniciá sesión en Chrome y reintentá.");
    log2("login ok ✓");
  }
  browserWarmedThisRun2 = true;
}
function pageFetch(method, apiPath, body) {
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
  return ab2(js);
}
function parsePageFetch(raw) {
  let s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"'))
    s = JSON.parse(s);
  const outer = JSON.parse(s);
  let body = outer.body;
  try {
    body = JSON.parse(outer.body);
  } catch {}
  return { status: outer.status, body };
}
async function reserveViaBrowser(siteId, showtimeId, seatIds, log2) {
  await ensureBrowser2(log2);
  log2("creando la orden…");
  const booking = parsePageFetch(pageFetch("POST", "/orders/standard/booking", { siteId, bookingMode: "Paid" }));
  if (booking.status !== 200)
    throw new Error(`no se pudo crear la orden (HTTP ${booking.status})`);
  const orderId = booking.body?.order?.id;
  if (!orderId)
    throw new Error("la orden no devolvió id");
  log2(`orden ${orderId} · seleccionando butacas…`);
  const upd = parsePageFetch(pageFetch("PUT", `/orders/${orderId}/showtimes/${showtimeId}`, { seats: seatIds, tickets: [] }));
  if (upd.status !== 200) {
    pageFetch("DELETE", `/orders/${orderId}`, undefined);
    throw new Error(`no se pudieron seleccionar las butacas (HTTP ${upd.status})`);
  }
  const total = upd.body?.order?.totalPrice?.valueIncludingTax;
  return { orderId, total };
}
async function cancelViaBrowser(orderId, log2) {
  await ensureBrowser2(log2);
  const r = parsePageFetch(pageFetch("DELETE", `/orders/${orderId}`, undefined));
  if (r.status !== 204 && r.status !== 200)
    throw new Error(`no se pudo cancelar (HTTP ${r.status})`);
}
async function checkoutViaBrowser2(siteId, showtimeId, seatIds, log2) {
  await ensureBrowser2(log2);
  log2("creando la orden y el pago…");
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
  const raw = ab2(js);
  let out;
  try {
    let s = raw.trim();
    if (s.startsWith('"') && s.endsWith('"'))
      s = JSON.parse(s);
    out = JSON.parse(s);
  } catch {
    throw new Error("no pude interpretar la respuesta del checkout");
  }
  if (out.error)
    throw new Error(out.error);
  if (!out.url)
    throw new Error(`no se generó el link de pago (HTTP ${out.status ?? "?"})`);
  return { orderId: out.orderId, total: out.value, paymentUrl: out.url };
}

// src/infrastructure/cinecolombia/cinecolombia.ts
var BASE4 = "https://digital-api.cinecolombia.com/ocapi/v1";
var UA4 = "cinesco-cli/0.1.0";
function authHeaders3(memberRequired = false) {
  const s = loadSession2();
  if (!s || !s.appToken) {
    throw new Error("falta la sesión de Cine Colombia. Corré: cinesco cinecolombia token (navegar) o login (miembro).");
  }
  if (s.expired)
    throw new Error("la sesión de Cine Colombia expiró. Volvé a correr 'cinesco cinecolombia token' o 'login'.");
  const headers2 = {
    Accept: "application/json",
    "User-Agent": UA4,
    Authorization: `Bearer ${s.appToken}`
  };
  if (s.memberCookie)
    headers2.Cookie = `vista-loyalty-member-authentication-token=${s.memberCookie}`;
  else if (memberRequired)
    throw new Error("esto necesita sesión de miembro. Corré: cinesco cinecolombia login");
  return headers2;
}
async function get3(path, memberRequired = false) {
  const res = await fetch(`${BASE4}${path}`, { headers: authHeaders3(memberRequired) });
  if (res.status === 401)
    throw new Error("sesión inválida o expirada (401). Corré 'cinesco cinecolombia login'.");
  return await res.json();
}
async function whoami2() {
  const d = await get3(`/members/current`, true);
  const m = d.member;
  const n = m?.personalDetails?.name;
  return {
    id: m?.id,
    email: m?.credentials?.email,
    name: n ? `${n.givenName ?? ""} ${n.familyName ?? ""}`.trim() : undefined,
    club: d.relatedData?.club?.name?.text
  };
}
async function showtimeSeats2(showtimeId) {
  const [avail, prices, detail] = await Promise.all([
    get3(`/showtimes/${showtimeId}/seat-availability`, true),
    get3(`/showtimes/${showtimeId}/ticket-prices`, true),
    get3(`/showtimes/${showtimeId}`, true)
  ]);
  const status = new Map((avail.seatAvailabilities ?? []).map((s) => [s.seatId, s.status]));
  const seats = [];
  const layoutId = detail.showtime?.seatLayoutId;
  if (layoutId) {
    try {
      const lay = await get3(`/seat-layouts/${layoutId}`, true);
      for (const area of lay.seatLayout?.areas ?? []) {
        const areaName = area.name?.text ?? `Zona ${area.number}`;
        for (const r of area.rows ?? []) {
          for (const s of r.seats ?? []) {
            if (!status.has(s.id))
              continue;
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
              status: status.get(s.id) ?? "Unknown"
            });
          }
        }
      }
    } catch {}
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
    precioDefault: def?.price?.valueIncludingTax
  };
}
function paintSeats(seats, chosen = new Set) {
  const areas = [...new Set(seats.map((s) => s.area))].sort((a, b) => a - b);
  for (const area of areas) {
    const zone = seats.filter((s) => s.area === area);
    const areaName = zone[0]?.areaName ?? `Zona ${area}`;
    const pref = /prefer/i.test(areaName);
    const rowLabels = [...new Set(zone.map((s) => s.rowLabel))].sort();
    const minCol = Math.min(...zone.map((s) => s.col));
    const maxCol = Math.max(...zone.map((s) => s.col));
    const width = (maxCol - minCol + 1) * 4;
    const label = `  PANTALLA  `;
    const pad = Math.max(2, Math.floor((width - label.length) / 2));
    process.stdout.write(`
` + style.bold(pref ? style.magenta(areaName) : style.cyan(areaName)) + `
` + "   " + style.dim("╭" + "─".repeat(pad) + label + "─".repeat(Math.max(2, width - pad - label.length)) + "╮") + `
`);
    const byKey = new Map(zone.map((s) => [`${s.rowLabel}_${s.col}`, s]));
    for (const rl of rowLabels) {
      let line = style.dim(rl.padStart(2)) + " ";
      for (let col = maxCol;col >= minCol; col--) {
        const s = byKey.get(`${rl}_${col}`);
        if (!s) {
          line += "    ";
          continue;
        }
        const n = s.number.padStart(2, "0").slice(-2);
        if (chosen.has(s.seatId))
          line += style.cyan(style.bold(`[${n}]`));
        else if (s.status !== "Available")
          line += style.red("[··]");
        else if (s.type === "Wheelchair" || s.type === "Companion")
          line += style.yellow(`[${n}]`);
        else if (pref)
          line += style.magenta(`[${n}]`);
        else
          line += style.green(`[${n}]`);
      }
      process.stdout.write(line.replace(/\s+$/, "") + `
`);
    }
  }
  process.stdout.write(`
   ` + [
    style.green("[00]") + " general",
    style.magenta("[00]") + " preferencial",
    style.yellow("[00]") + " ruedas",
    style.red("[··]") + " ocupada",
    style.cyan("[00]") + " elegida"
  ].join("  ") + `
` + style.dim("   elegí por fila+número (ej: H12) o por seatId (ej: 1_3_5)") + `
`);
}
var PAYMENT_URL = "https://multiplex.cinecolombia.com/order/payment?deliveryMode=Pickup";
function paymentUrl() {
  return PAYMENT_URL;
}

// src/shared/prompt.ts
import { createInterface as createInterface2 } from "node:readline";
async function promptLine2(question) {
  if (!process.stdin.isTTY)
    return null;
  const rl = createInterface2({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
async function promptSelect2(title, options) {
  if (!process.stdin.isTTY)
    return null;
  process.stderr.write(`
` + title + `
`);
  options.forEach((o, i) => process.stderr.write(`  ${String(i + 1).padStart(2)}. ${o}
`));
  for (;; ) {
    const ans = await promptLine2(`elegí [1-${options.length}]: `);
    if (ans === null)
      return null;
    const n = Number(ans);
    if (Number.isInteger(n) && n >= 1 && n <= options.length)
      return n - 1;
    process.stderr.write(`opción inválida
`);
  }
}
async function promptSecret2(question) {
  if (!process.stdin.isTTY)
    return null;
  process.stderr.write(question);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let secret = "";
    const onData = (ch) => {
      for (const c of ch) {
        if (c === "\r" || c === `
`) {
          cleanup();
          process.stderr.write(`
`);
          resolve(secret);
          return;
        } else if (c === "\x03") {
          cleanup();
          process.stderr.write(`
`);
          resolve(null);
          return;
        } else if (c === "" || c === "\b") {
          secret = secret.slice(0, -1);
        } else {
          secret += c;
        }
      }
    };
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    stdin.on("data", onData);
  });
}

// src/infrastructure/royalfilms/audit.ts
import { homedir as homedir5 } from "node:os";
import { join as join6 } from "node:path";
import { mkdirSync as mkdirSync4, appendFileSync, chmodSync as chmodSync4 } from "node:fs";
var DIR4 = join6(homedir5(), ".royalfilms", "audit");
function today() {
  return new Date().toISOString().slice(0, 10);
}
function write(record) {
  mkdirSync4(DIR4, { recursive: true });
  const file = join6(DIR4, `${today()}.jsonl`);
  appendFileSync(file, JSON.stringify(record) + `
`, { mode: 384 });
  try {
    chmodSync4(file, 384);
  } catch {}
}
var counter = 0;
function newId() {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}
function auditPending(action, request2) {
  const id = newId();
  write({ id, ts: new Date().toISOString(), action, phase: "pending", request: request2 });
  return {
    id,
    final(outcome, detail) {
      write({ id, ts: new Date().toISOString(), action, phase: "final", outcome, detail });
    }
  };
}

// src/presentation/commands.ts
import { homedir as homedir6 } from "node:os";
import { join as join7 } from "node:path";
import { writeFileSync as writeFileSync5 } from "node:fs";
async function findCinema(cityId, multicineId, token) {
  const cinemas = await apiGet(`/cinemas/city/${cityId}`, token);
  const c = cinemas.find((x) => Number(x.multicine_id) === multicineId);
  if (!c || c.CompanyInfo == null)
    return null;
  const company = c.CompanyInfo;
  return { codigo: Number(c.multicine_codigo), posEpayco: Number(company.empresa_pos_epayco) };
}
function openInBrowser(path) {
  try {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    launch2(cmd, [path]);
  } catch {}
}
async function makePaymentSession(token, cinema, amount, invoiceRef) {
  const sessionData = buildSessionData({
    posEpayco: cinema.posEpayco,
    multicineCodigo: cinema.codigo,
    amount,
    billing: billingFromToken(token),
    invoiceRef
  });
  const sessionId = await getSessionId(sessionData, token);
  const htmlPath = join7(homedir6(), ".royalfilms", `pago-${invoiceRef}.html`);
  writeFileSync5(htmlPath, buildCheckoutHtml(sessionId, fmtCOP(amount)), { mode: 384 });
  return { sessionId, htmlPath };
}
class UsageError extends Error {
}
var fmtCOP = (n) => typeof n === "number" ? "$" + n.toLocaleString("es-CO") : "—";
async function allTicketSales(token, doc) {
  const d = await apiGet(`/ticket/document/${doc}`, token);
  return [...d.unredeemed ?? [], ...d.redeemed ?? []];
}
async function ticketSaleIds(token, doc) {
  return new Set((await allTicketSales(token, doc)).map((s) => Number(s.venta_id)));
}
async function fetchTypeNames(token) {
  try {
    const types = await apiGet(`/cinemas/halls/chairTypes`, token);
    return new Map(types.map((t) => [Number(t.tipo_silla_id), String(t.tipo_silla_nombre)]));
  } catch {
    return new Map;
  }
}
function tierLines(sum) {
  return sum.tiers.map((t) => `  ${style.cyan((t.nombre ?? `tipo ${t.tipo_silla_id}`).padEnd(16))} ${fmtCOP(t.precio).padStart(10)}   ${t.disponibles}/${t.total} libres`).join(`
`);
}
async function runBuyWizard() {
  if (!process.stdin.isTTY) {
    throw new UsageError("el asistente 'buy' es interactivo y necesita una terminal. Usá los comandos sueltos (seats map, reserve hold) en modo automático.");
  }
  logo();
  const pick = async (title, items, label) => {
    if (items.length === 0)
      throw new UsageError("no hay opciones disponibles en este paso");
    const i = await promptSelect2(title, items.map(label));
    if (i === null)
      throw new UsageError("selección cancelada");
    return items[i];
  };
  const countries = await apiGet(`/countries`);
  const country = await pick("¿De qué país sos?", countries, (c) => String(c.pais_nombre));
  const cities2 = (await apiGet(`/cities`)).filter((c) => c.pais_id === country.pais_id);
  const city = await pick("¿De qué ciudad?", cities2, (c) => String(c.ciudad_nombre));
  const cityId = Number(city.ciudad_id);
  const billboard = await apiGet(`/billboard/city/${cityId}`);
  if (billboard.length === 0)
    throw new UsageError(`no hay cartelera para ${city.ciudad_nombre}`);
  const movieRow = await pick(`¿Qué película querés ver en ${city.ciudad_nombre}?`, billboard, (b) => String(b.pelicula?.pelicula_nombre_formato ?? ""));
  const movie = movieRow.pelicula;
  const movieId = Number(movie.pelicula_id);
  const functions = await apiGet(`/movies/functions/${movieId}/city/${cityId}`);
  if (functions.length === 0)
    throw new UsageError("esa película no tiene funciones activas");
  const byDate = groupByDate(functions);
  const day = await pick("¿Qué día?", byDate, (d) => `${d.fecha}  (${d.funciones.length} funciones)`);
  const cinemas = groupByCinema(day.funciones);
  const cine = await pick("¿En qué cine?", cinemas, (c) => `${c.nombre}  (${c.funciones.length} funciones)`);
  const fn = await pick(`¿Qué función en ${cine.nombre}?`, cine.funciones, funcLabelShort);
  let sess = loadSession();
  if (!sess || isExpired(sess)) {
    note(style.yellow(`
necesitás iniciar sesión para ver el mapa y reservar.`));
    const email = await promptLine2("correo: ") || "";
    const password = await promptSecret2("clave: ") || "";
    if (!email || !password)
      throw new UsageError("faltan credenciales");
    sess = await login(email, password);
  }
  const token = sess.token;
  const map = await apiGet(`/cinemas/halls/id/${fn.funcion_sala_id}/function/id/${fn.funcion_id}/channel/id/1/user/id/${sess.user.id}`, token);
  const typeNames2 = await fetchTypeNames(token);
  const sum = summarize(map, typeNames2);
  heading(`${movie.pelicula_nombre_formato}`);
  note(`${fn.funcion_fecha} · ${funcLabel(fn)}`);
  note(`${sum.disponibles} libres · máx ${sum.maxPorCompra} por compra`);
  paintSeatMap(map);
  note(`
precio por tipo:`);
  note(tierLines(sum));
  const libres = map.mapa_sala.filter((c) => c.silla_disponible).slice(0, 10).map((c) => c.mapa_sala_numero_silla);
  note(`
libres, por ejemplo: ` + libres.join(", "));
  let seats = [];
  for (;; ) {
    const ans = await promptLine2(`
butacas — podés elegir varias separadas por coma (ej: F17,F16,F15) o 'q': `);
    if (ans === null || ans.toLowerCase() === "q")
      throw new UsageError("compra cancelada");
    const r = resolveSeats(ans.split(","), map.mapa_sala);
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
  const byId = new Map(map.mapa_sala.map((c) => [c.silla_id, c]));
  const total = seats.reduce((a, s) => a + (seatPrice(byId.get(s.id)) ?? 0), 0);
  paintSeatMap(map, new Set(seats.map((s) => s.id)));
  note(`
elegiste: ${seats.map((s) => s.numero).join(", ")} · total ${style.bold(fmtCOP(total))}`);
  const conf = await promptLine2("¿reservar estas butacas? (s/N): ") || "";
  if (conf.toLowerCase() !== "s" && conf.toLowerCase() !== "si") {
    return { data: { cancelled: true, seats, total }, human() {
      note("cancelado, no se reservó nada.");
    } };
  }
  const body = buildReserveBody(fn.funcion_id, fn.funcion_multicine_id, fn.funcion_sala_id, seats);
  const audit = auditPending("buy.reserve", { body, seats });
  let reservaId;
  let reserveInfo;
  try {
    const res = await reserve(body, token);
    const r = res.reserve;
    reservaId = r.reserva_silla_id;
    reserveInfo = {
      reserva_silla_id: r.reserva_silla_id,
      reserva_silla_funcion: r.reserva_silla_funcion,
      reserva_silla_multicine: r.reserva_silla_multicine,
      reserva_silla_sala: r.reserva_silla_sala,
      reserva_silla_total: total
    };
    audit.final("ok", { reserva_silla_id: reservaId });
  } catch (e) {
    audit.final("error", { message: e.message });
    throw e;
  }
  heading("¡Butacas retenidas!");
  note(`${movie.pelicula_nombre_formato} · ${fn.funcion_fecha} ${funcLabel(fn)}`);
  note(`reserva #${reservaId} · ${seats.map((s) => s.numero).join(", ")} · ${style.bold(fmtCOP(total))}`);
  note(`la retención expira en ~${map.configuracion_general.duracion_tiempo_transaccion} min.`);
  let payment = null;
  let ventaId;
  note(style.dim(`
nota: se crea una venta pendiente; si abandonás sin pagar queda EN PROCESO y bloquea nuevas compras hasta que expire.`));
  const wantPay = await promptLine2("¿crear la venta y generar el pago de ePayco? (s/N): ") || "";
  if (wantPay.toLowerCase() === "s" || wantPay.toLowerCase() === "si") {
    const cinema = await findCinema(cityId, fn.funcion_multicine_id, token);
    if (!cinema || Number.isNaN(cinema.posEpayco)) {
      note(style.red("no encontré el POS de ePayco para este cine; no se pudo generar el pago."));
    } else {
      try {
        const sale = await createSale({
          token,
          session: sess,
          cityId,
          multicineId: fn.funcion_multicine_id,
          movieId,
          fn,
          map,
          typeNames: typeNames2,
          chosen: seats,
          reserve: reserveInfo,
          total
        });
        ventaId = sale.venta_id;
        note(style.green(`venta #${ventaId} creada (pendiente de pago)`));
      } catch (e) {
        const m = e.message;
        note(style.red(`no se pudo crear la venta: ${m}`));
        if (/pendiente/i.test(m))
          note(style.dim("tenés una venta pendiente sin pagar; esperá a que expire o completá ese pago."));
      }
      const invoiceRef = ventaId ? String(ventaId) : `${fn.funcion_id}-${reservaId}`;
      payment = await makePaymentSession(token, cinema, total, invoiceRef);
      openInBrowser(payment.htmlPath);
      note(style.green(`
sesión de pago creada · sessionId ${payment.sessionId}`));
      note("abrí el formulario de ePayco en el navegador (lo intenté abrir automáticamente):");
      note("  " + style.bold(payment.htmlPath));
      note(style.dim(`  (si no se abrió: open "${payment.htmlPath}")`));
      const doc = String(decodeJwt(token).user?.usuario_cliente_documento ?? "");
      if (doc) {
        note(`
esperando el pago… (Ctrl-C para salir; no cobra el CLI)`);
        const before = await ticketSaleIds(token, doc);
        const deadline = Date.now() + 10 * 60 * 1000;
        let fresh;
        while (Date.now() < deadline && !fresh) {
          await sleep2(5000);
          try {
            fresh = (await allTicketSales(token, doc)).find((s) => !before.has(Number(s.venta_id)));
          } catch {}
        }
        if (fresh)
          note(style.green(`
✓ ¡Pago confirmado! venta #${fresh.venta_id} · ${fmtCOP(Number(fresh.venta_total))}. Boletas en tu cuenta.`));
        else
          note(style.yellow(`
no detecté el pago a tiempo. Revisá 'royalfilms sales' o tu correo.`));
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
      payment
    },
    nextSteps: payment ? [`open ${payment.htmlPath}`, `reserve release ${reservaId}`] : [`reserve release ${reservaId}`],
    human() {
      note(style.yellow(`
No se cobró nada. El pago solo ocurre si lo confirmás en el formulario de ePayco.`));
      note(style.dim(`si te arrepentís: royalfilms reserve release ${reservaId}`));
    }
  };
}

// src/application/purchase.ts
class PurchaseTickets {
  port;
  constructor(port) {
    this.port = port;
  }
  login(credentials) {
    return this.port.login(credentials);
  }
  seatMap(showtime, session) {
    return this.port.getSeatMap(showtime, session);
  }
  fares(showtime, session) {
    return this.port.listFares(showtime, session);
  }
  paymentMethods() {
    return this.port.paymentMethods();
  }
  async checkout(input) {
    const order = await this.port.reserve({
      session: input.session,
      showtime: input.showtime,
      movie: input.movie,
      regionId: input.regionId,
      seats: input.seats,
      fare: input.fare
    });
    const link = await this.port.pay({
      session: input.session,
      order,
      showtime: input.showtime,
      movie: input.movie,
      seats: input.seats,
      method: input.method
    });
    return { order, link };
  }
}

// src/application/browse.ts
class BrowseCatalog {
  catalog;
  constructor(catalog) {
    this.catalog = catalog;
  }
  regions() {
    return this.catalog.listRegions?.() ?? Promise.resolve([]);
  }
  cinemas(regionId) {
    return this.catalog.listCinemas(regionId);
  }
  movies(regionId) {
    return this.catalog.listMovies(regionId);
  }
  showtimes(query) {
    return this.catalog.listShowtimes(query);
  }
  static byCinema(showtimes) {
    const order = [];
    const map = new Map;
    for (const st of showtimes) {
      if (!map.has(st.cinemaId)) {
        map.set(st.cinemaId, []);
        order.push(st.cinemaId);
      }
      map.get(st.cinemaId).push(st);
    }
    return order.map((id) => ({
      cinemaId: id,
      name: map.get(id)[0].cinemaName ?? id,
      showtimes: map.get(id).sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))
    }));
  }
}

// src/application/seats.ts
function resolveSeats2(labels, map) {
  const byLabel = new Map;
  for (const r of map.rows)
    for (const s of r.seats)
      byLabel.set(s.label.toUpperCase(), s);
  const seats = [];
  const problems = [];
  for (const raw of labels) {
    const tok = raw.trim().toUpperCase();
    if (!tok)
      continue;
    const s = byLabel.get(tok);
    if (!s)
      problems.push(`"${raw}" no existe en esta sala`);
    else if (!s.available)
      problems.push(`${s.label} ya está ocupada`);
    else if (seats.some((x) => x.label === s.label))
      continue;
    else
      seats.push(s);
  }
  return { seats, problems };
}
function defaultFare(fares) {
  const usable = fares.filter((f) => f.priceCents > 0);
  const general = usable.filter((f) => !/preferenc|premium|vip|especial/i.test(f.name));
  const pool = general.length ? general : usable.length ? usable : fares;
  return [...pool].sort((a, b) => a.priceCents - b.priceCents)[0];
}

// src/presentation/seatmap.ts
function paintSeatMap2(map, selected = new Set) {
  const CELL = 5;
  const gutter = 3;
  const width = map.columns * CELL;
  const label = "  P A N T A L L A  ";
  const side = Math.max(2, Math.floor((width - label.length) / 2));
  const bar = "─".repeat(side) + label + "─".repeat(Math.max(2, width - side - label.length));
  process.stdout.write(`
` + " ".repeat(gutter) + style.dim("╭" + bar + "╮") + `
`);
  process.stdout.write(" ".repeat(gutter) + style.dim("╰" + "─".repeat(bar.length) + "╯") + `

`);
  const box = (inner, paint3) => paint3("[" + inner + "]") + " ";
  let hasSpecial = false;
  for (const r of map.rows) {
    const byCol = new Map(r.seats.map((s) => [s.column, s]));
    let line = style.dim((r.name || " ").padEnd(2, " ")) + " ";
    for (let c = 1;c <= map.columns; c++) {
      const s = byCol.get(c);
      if (!s) {
        line += " ".repeat(CELL);
        continue;
      }
      const n = (s.id.match(/\d+/)?.[0] ?? s.id).padStart(2, "0").slice(-2);
      if (s.special)
        hasSpecial = true;
      if (selected.has(s.label))
        line += box(n, (t) => style.cyan(style.bold(t)));
      else if (!s.available)
        line += box("··", style.red);
      else if (s.special)
        line += box(n, style.magenta);
      else
        line += box(n, style.green);
    }
    process.stdout.write(line.replace(/\s+$/, "") + `
`);
  }
  const legend = [
    style.green("[00]") + " libre",
    ...hasSpecial ? [style.magenta("[00]") + " preferencial"] : [],
    style.red("[··]") + " ocupada",
    style.cyan("[00]") + " elegida"
  ];
  process.stdout.write(`
` + " ".repeat(gutter) + legend.join("   ") + `
`);
}

// src/presentation/doctor.ts
function has(bin) {
  try {
    return which(bin) != null;
  } catch {
    return false;
  }
}
function doctorCmd(json) {
  const checks = [];
  const ab3 = has("agent-browser");
  checks.push({
    check: "agent-browser",
    status: ab3 ? "ok" : "missing",
    detail: ab3 ? "instalado" : "requerido para Cine Colombia (login/compra por navegador)",
    fix: ab3 ? "" : "npm i -g agent-browser  (o: brew install agent-browser) && agent-browser install"
  });
  const chrome = has("google-chrome") || has("chromium") || has("chromium-browser") || process.platform === "darwin";
  checks.push({
    check: "chrome",
    status: chrome ? "ok" : "missing",
    detail: chrome ? "disponible" : "agent-browser necesita un Chrome",
    fix: chrome ? "" : "agent-browser install"
  });
  const rf = loadSession();
  checks.push({
    check: "sesión royalfilms",
    status: !rf ? "missing" : isExpired(rf) ? "stale" : "ok",
    detail: !rf ? "sin login" : isExpired(rf) ? "expirada" : `${rf.user.correo ?? rf.user.id}`,
    fix: !rf || isExpired(rf) ? "cinesco royalfilms login" : ""
  });
  const cc = loadSession2();
  checks.push({
    check: "sesión cinecolombia",
    status: !cc || !cc.memberCookie ? "missing" : cc.expired ? "stale" : "ok",
    detail: !cc || !cc.memberCookie ? "sin login" : cc.expired ? "expirada" : "socio activo",
    fix: !cc || !cc.memberCookie || cc.expired ? "cinesco cinecolombia login  (abre el navegador)" : ""
  });
  checks.push({ check: "cinemark", status: "ok", detail: "login headless por compra (sin sesión guardada)", fix: "" });
  const missing = checks.filter((c) => c.status !== "ok");
  if (json) {
    emitJson({ ok: missing.length === 0, command: "doctor", count: checks.length, data: checks, nextSteps: missing.map((c) => c.fix).filter(Boolean) });
    return 0;
  }
  heading("cinesco doctor");
  const paint3 = (s) => s === "ok" ? style.green("ok") : s === "stale" ? style.yellow("stale") : style.red("falta");
  table(checks.map((c) => ({ check: c.check, estado: paint3(c.status), detalle: c.detail, arreglo: c.fix || "—" })), [
    { key: "check", label: "Chequeo", color: style.cyan },
    { key: "estado", label: "Estado" },
    { key: "detalle", label: "Detalle", max: 40 },
    { key: "arreglo", label: "Arreglo", max: 44 }
  ]);
  if (missing.length === 0)
    note(style.green(`
✓ todo listo — podés comprar en las 3 cadenas.`));
  else
    note(style.dim(`
${missing.length} pendiente(s). Corré los 'arreglo' de arriba.`));
  return 0;
}

// src/presentation/skills.ts
var MANUAL = `# cinesco — agent manual

One terminal over 3 Colombian cinema chains: Royal Films, Cine Colombia, Cinemark.
Agent-first: JSON output automatically when stdout is not a TTY; exit 0 ok / 1 api / 2 usage.

## Start here
- \`cinesco doctor\`      what's installed/logged in and the command that fixes each gap
- \`cinesco providers\`   the three chains + capabilities
- \`cinesco schema\`      command contract (for agents)

## Search a movie across all 3 chains
- \`cinesco search "<movie>" --city <city> --json\`  → per chain: matches + region + nextSteps

## Browse (headless, no login)
- \`cinesco <chain> regions\`                 cities
- \`cinesco <chain> cinemas [region]\`        cinemas
- \`cinesco <chain> movies <region>\`         billboard
- \`cinesco <chain> showtimes <movieId> <region>\`  showtimes
  chain = royalfilms | cinecolombia | cinemark

## Buy — interactive (human) OR agent-ready (--json)
- Human: \`cinesco start\` — guided wizard (needs a terminal).
- Agent (no wizard, credentials via <CHAIN>_EMAIL / <CHAIN>_PASSWORD env vars):
  - \`cinesco <chain> seats  --cinema <id> --session <id> --json\`   free seats
  - \`cinesco <chain> fares  --cinema <id> --session <id> --json\`   ticket types + price
  - \`cinesco <chain> order  --cinema <id> --session <id> --seats F6 --movie <id> --region <city> [--bank 1007] --json\`
    → { orderId, total, seats, paymentUrl }. NEVER charges — stops at the link.
- Conversational flow: fill slots (city→movie→cinema→day→time→seat) by calling the JSON
  commands and asking only for what's missing. See skills/cinesco/SKILL.md.

## Dependencies
- **Cine Colombia** needs **agent-browser** (login + checkout via browser; Cloudflare + reCAPTCHA).
  Install: \`npm i -g agent-browser && agent-browser install\`
- Royal Films and Cinemark are 100% headless (no browser).

## Privacy
Each user logs in with THEIR credentials; the CLI sends THEIR data (name, email, phone,
national id) ONLY to their cinema's official API, over HTTPS, for their purchase. Tokens
live in ~/.cinesco and ~/.royalfilms (mode 600); the password is never stored. Sole
third-party call: api.ipify.org (gets your public IP for Cinemark's PSE payment).
`;
function skillsCmd(json) {
  if (json)
    emitJson({ ok: true, command: "skills", data: { manual: MANUAL } });
  else
    process.stdout.write(MANUAL + `
`);
  return 0;
}

// src/presentation/bigtext.ts
var F = {
  A: ["████", "█  █", "████", "█  █", "█  █"],
  B: ["███ ", "█  █", "███ ", "█  █", "███ "],
  C: [" ███", "█   ", "█   ", "█   ", " ███"],
  D: ["███ ", "█  █", "█  █", "█  █", "███ "],
  E: ["████", "█   ", "███ ", "█   ", "████"],
  F: ["████", "█   ", "███ ", "█   ", "█   "],
  I: ["███", " █ ", " █ ", " █ ", "███"],
  K: ["█  █", "█ █ ", "██  ", "█ █ ", "█  █"],
  L: ["█   ", "█   ", "█   ", "█   ", "████"],
  M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
  O: [" ██ ", "█  █", "█  █", "█  █", " ██ "],
  R: ["███ ", "█  █", "███ ", "█ █ ", "█  █"],
  S: [" ███", "█   ", " ██ ", "   █", "███ "],
  Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
  " ": ["  ", "  ", "  ", "  ", "  "]
};
function bigText(text) {
  const chars = [...text.toUpperCase()].map((c) => F[c]).filter(Boolean);
  if (!chars.length)
    return "";
  const rows = [];
  for (let r = 0;r < 5; r++) {
    rows.push(chars.map((g) => g[r].padEnd(Math.max(...g.map((x) => x.length)), " ")).join("  "));
  }
  return rows.join(`
`);
}

// src/infrastructure/royalfilms/auth.ts
async function login2(email, password) {
  const token = await apiPost(`/auth/login`, { email, password });
  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new ApiError("bad-login", "el login no devolvió un token válido");
  }
  return saveSession(token);
}
function requireToken2() {
  const session = loadSession();
  if (!session) {
    throw new ApiError("not-authenticated", "no hay sesión — corré 'royalfilms auth login'");
  }
  if (isExpired(session)) {
    throw new ApiError("session-expired", "la sesión expiró — corré 'royalfilms auth login'");
  }
  return { token: session.token, session };
}

// src/infrastructure/royalfilms/session.ts
import { homedir as homedir7 } from "node:os";
import { join as join8 } from "node:path";
import { mkdirSync as mkdirSync5, writeFileSync as writeFileSync6, readFileSync as readFileSync4, rmSync as rmSync2, existsSync as existsSync5, chmodSync as chmodSync5 } from "node:fs";
var DIR5 = join8(homedir7(), ".royalfilms");
var FILE4 = join8(DIR5, "session.json");
function decodeJwt2(token) {
  const parts = token.split(".");
  if (parts.length !== 3)
    throw new Error("token no es un JWT");
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64 + "=".repeat((4 - b64.length % 4) % 4);
  const json = Buffer.from(pad, "base64").toString("utf8");
  return JSON.parse(json);
}
function loadSession4() {
  if (!existsSync5(FILE4))
    return null;
  try {
    return JSON.parse(readFileSync4(FILE4, "utf8"));
  } catch {
    return null;
  }
}
function isExpired2(session, skewSeconds = 30) {
  if (!session.exp)
    return false;
  return Date.now() / 1000 >= session.exp - skewSeconds;
}

// src/infrastructure/royalfilms/api.ts
var BASE5 = "https://cinemasroyalfilms.com/api";
var UA5 = "royalfilms-cli/0.1.0 (+https://github.com/) node-fetch";

class ApiError2 extends Error {
  code;
  httpStatus;
  constructor(code, message, httpStatus) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
function authHeaders4(token) {
  const h = { Accept: "application/json", "User-Agent": UA5 };
  if (token)
    h.Authorization = `Bearer ${token}`;
  return h;
}
async function apiGet2(path, token) {
  const url = `${BASE5}${path}`;
  let res;
  try {
    res = await fetch(url, { headers: authHeaders4(token) });
  } catch (e) {
    throw new ApiError2("network", `no se pudo alcanzar ${url}: ${e.message}`);
  }
  const text = await res.text();
  return handle2(text, res, path);
}
function handle2(text, res, path) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError2("bad-response", `respuesta no-JSON de ${path} (HTTP ${res.status})`, res.status);
  }
  if (res.status === 401) {
    throw new ApiError2("unauthorized", body.message || "sesión inválida o expirada — corré 'royalfilms auth login'", 401);
  }
  if (body.status === false) {
    throw new ApiError2("api-error", body.message || `el endpoint reportó un error`, res.status);
  }
  if (!res.ok) {
    throw new ApiError2("http-error", body.message || `HTTP ${res.status}`, res.status);
  }
  return body.data ?? [];
}

// src/presentation/cinesco.ts
async function ccWaitPayment(orderId, log2) {
  const deadline = Date.now() + 10 * 60 * 1000;
  let last = "";
  while (Date.now() < deadline) {
    await sleep(5000);
    let st;
    try {
      st = await orderStatusViaBrowser(orderId, () => {});
    } catch {
      continue;
    }
    if (!st.exists)
      return "cancelled";
    if (st.paid)
      return "paid";
    if (st.status && st.status !== last) {
      log2(`  \u2026 estado: ${st.status} (esperando el pago)`);
      last = st.status;
    }
  }
  return "timeout";
}
async function rfSaleIds(token, doc) {
  const d = await apiGet2(`/ticket/document/${doc}`, token);
  const ids = new Set;
  for (const s of [...d.redeemed ?? [], ...d.unredeemed ?? []])
    ids.add(Number(s.venta_id));
  return ids;
}
async function rfWaitPayment(token, doc, log2) {
  const before = await rfSaleIds(token, doc);
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    try {
      const d = await apiGet2(`/ticket/document/${doc}`, token);
      const all = [...d.redeemed ?? [], ...d.unredeemed ?? []];
      const fresh = all.find((s) => !before.has(Number(s.venta_id)));
      if (fresh)
        return { outcome: "paid", venta: fresh };
    } catch {}
  }
  return { outcome: "timeout" };
}
function rfDocFromToken(token) {
  const u = decodeJwt2(token).user ?? {};
  return String(u.usuario_cliente_documento ?? "");
}
var VERSION = "0.1.0";
function openInBrowser2(target) {
  try {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    launch(cmd, [target]);
  } catch {}
}
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  let json = false;
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json")
      json = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--"))
        flags[key] = argv[++i];
      else
        flags[key] = "true";
    } else
      positionals.push(a);
  }
  return { positionals, flags, json };
}
function logo2() {
  if (!process.stdout.isTTY)
    return;
  const strip = style2.dim("\u2590\u258C ".repeat(16).trimEnd());
  process.stderr.write(`
` + strip + `
`);
  for (const l of [
    " \u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557\u2588\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557     \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557",
    "\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D    \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557",
    "\u2588\u2588\u2551     \u2588\u2588\u2551\u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557    \u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551",
    "\u2588\u2588\u2551     \u2588\u2588\u2551\u2588\u2588\u2551\u255A\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2588\u2588\u2551    \u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551",
    "\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551    \u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D",
    " \u255A\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u2550\u2550\u255D\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D     \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D"
  ])
    process.stderr.write(style2.bold(style2.cyan(l)) + `
`);
  process.stderr.write(style2.dim(`   una terminal, todas las salas de cine
`) + strip + `
`);
}
function providersCmd(json) {
  const rows = PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    pais: p.country,
    auth: p.auth,
    capacidades: Object.entries(p.capabilities).filter(([, v]) => v).map(([k]) => k).join(",")
  }));
  if (json) {
    emitJson2({ ok: true, command: "providers", count: rows.length, data: PROVIDERS.map((p) => ({ id: p.id, name: p.name, country: p.country, auth: p.auth, notes: p.notes, capabilities: p.capabilities })) });
  } else {
    heading2("Cadenas disponibles");
    table2(rows, [
      { key: "id", label: "ID", color: style2.cyan },
      { key: "name", label: "Cadena" },
      { key: "pais", label: "Pa\xEDs" },
      { key: "auth", label: "Login" },
      { key: "capacidades", label: "Capacidades", max: 34 }
    ]);
  }
}
function schemaCmd(json) {
  const spec = {
    name: "cinesco",
    version: VERSION,
    schemaVersion: 1,
    providers: PROVIDERS.map((p) => ({ id: p.id, name: p.name, auth: p.auth, capabilities: p.capabilities })),
    commands: [
      { command: "providers", args: [], summary: "Listar las cadenas" },
      { command: "<provider> cinemas", args: ["[region]"], summary: "Cines de una cadena" },
      { command: "<provider> movies", args: ["[region]"], summary: "Cartelera de una cadena" },
      { command: "<provider> showtimes", args: ["movieId", "[region]"], summary: "Funciones" },
      { command: "<provider> seats", args: ["--cinema", "--session"], summary: "Butacas libres (datos)" },
      { command: "<provider> fares", args: ["--cinema", "--session"], summary: "Tipos de boleta + precio" },
      { command: "<provider> order", args: ["--cinema", "--session", "--seats", "[--bank]"], summary: "Reservar + link de pago (no cobra)" },
      { command: "search", args: ["<pelicula>", "--city"], summary: "Buscar una peli en las 3 cadenas" },
      { command: "start", args: [], summary: "Asistente: eleg\xED cadena y explor\xE1 (interactivo)" }
    ],
    exitCodes: { "0": "ok", "1": "api/network", "2": "usage" }
  };
  if (json)
    emitJson2({ ok: true, command: "schema", data: spec });
  else {
    heading2(`cinesco schema v${spec.schemaVersion}`);
    table2(spec.commands, [
      { key: "command", label: "Comando", color: style2.cyan },
      { key: "summary", label: "Descripci\xF3n", max: 40 }
    ]);
  }
}
async function runProviderVerb(p, verb, pos, flags, json) {
  const region = pos[0] || flags.region;
  const cmd = `${p.id} ${verb}`;
  try {
    if (verb === "cinemas") {
      const data = await p.catalog.listCinemas(region);
      out(json, cmd, data, ["<provider> movies [region]"], () => {
        heading2(`${p.name} \xB7 cines${region ? ` (region ${region})` : ""}`);
        table2(data, [{ key: "id", label: "ID", color: style2.cyan }, { key: "name", label: "Cine" }]);
      });
    } else if (verb === "movies") {
      const data = await p.catalog.listMovies(region);
      out(json, cmd, data, [`${p.id} showtimes <movieId> ${region ?? "[region]"}`], () => {
        heading2(`${p.name} \xB7 cartelera`);
        table2(data, [{ key: "id", label: "ID", color: style2.cyan }, { key: "title", label: "Pel\xEDcula", max: 50 }]);
      });
    } else if (verb === "showtimes") {
      const movieId = pos[0];
      if (!movieId)
        throw new UsageError2("falta movieId");
      const reg = pos[1] || flags.region;
      const data = await p.catalog.listShowtimes({ movieId, regionId: reg, cinemaId: flags.cinema });
      out(json, cmd, data, [], () => {
        heading2(`${p.name} \xB7 funciones de ${movieId}`);
        table2(data, [
          { key: "id", label: "Funci\xF3n", color: style2.cyan },
          { key: "date", label: "Fecha" },
          { key: "time", label: "Hora" },
          { key: "cinemaId", label: "Cine" }
        ]);
      });
    } else if (verb === "regions") {
      if (!p.catalog.listRegions)
        throw new UsageError2(`${p.name} no maneja regiones`);
      const data = await p.catalog.listRegions();
      out(json, cmd, data, [`${p.id} cinemas <region>`], () => {
        heading2(`${p.name} \xB7 ciudades`);
        table2(data, [{ key: "id", label: "ID", color: style2.cyan }, { key: "name", label: "Ciudad" }]);
      });
    } else {
      throw new UsageError2(`verbo desconocido: ${verb} (prob\xE1 cinemas | movies | showtimes | regions)`);
    }
    return 0;
  } catch (e) {
    if (e instanceof UsageError2) {
      if (json)
        emitJson2({ ok: false, command: cmd, error: { code: "usage", message: e.message } });
      else
        errline(`${cmd}: ${e.message}`);
      return 2;
    }
    const msg = e.message ?? String(e);
    const code = msg.includes("not-implemented") ? "not-implemented" : "provider-error";
    if (json)
      emitJson2({ ok: false, command: cmd, error: { code, message: msg } });
    else
      errline(`${cmd}: ${msg}`);
    return 1;
  }
}

class UsageError2 extends Error {
}
function out(json, command, data, nextSteps, human) {
  if (json)
    emitJson2({ ok: true, command, count: Array.isArray(data) ? data.length : undefined, data, nextSteps });
  else {
    human();
    if (nextSteps.length)
      note2(`
siguiente: ` + nextSteps.map((s) => style2.dim(s)).join("  \xB7  "));
  }
}
async function startWizard() {
  if (!process.stdin.isTTY) {
    errline("'start' es interactivo; us\xE1 los comandos sueltos (cinesco <provider> movies) en modo autom\xE1tico.");
    return 2;
  }
  logo2();
  const i = await promptSelect("\xBFEn qu\xE9 cine quer\xE9s comprar o reservar?", PROVIDERS.map((p2) => `${p2.name}  (${p2.country})`));
  if (i === null)
    return 2;
  const p = PROVIDERS[i];
  const banner = bigText(p.name);
  if (banner)
    process.stdout.write(`
` + style2.bold(style2.cyan(banner)) + `
`);
  note2(style2.dim(`   v${VERSION}`));
  note2(`${style2.dim(p.notes ?? "")}
`);
  if (p.purchase)
    return runPurchaseWizard(p);
  note2(`${p.name} no tiene compra por API todav\xEDa.`);
  return 0;
}
async function runPurchaseWizard(provider) {
  if (!provider.purchase) {
    errline(`${provider.name} no tiene compra por API todav\xEDa.`);
    return 2;
  }
  const { promptLine: promptLine3, promptSecret: promptSecret3 } = await Promise.resolve().then(() => (init_prompt(), exports_prompt));
  const browse = new BrowseCatalog(provider.catalog);
  const purchase = new PurchaseTickets(provider.purchase);
  const pick = async (title, items, label) => {
    if (items.length === 0) {
      note2("no hay opciones en este paso");
      return null;
    }
    const idx = await promptSelect(title, items.map(label));
    return idx === null ? null : items[idx];
  };
  const fmtCOP2 = (n) => "$" + n.toLocaleString("es-CO");
  let session;
  const isNo = (s) => ["n", "no"].includes(s.trim().toLowerCase());
  if (provider.auth === "browser-assisted") {
    note2(style2.yellow("necesit\xE1s iniciar sesi\xF3n en el navegador (se hace una vez)."));
    const yn = await promptLine3("\xBFinicio sesi\xF3n ahora? (s/N): ") || "";
    if (yn.toLowerCase() !== "s" && yn.toLowerCase() !== "si") {
      note2("ok, cancelado.");
      return 0;
    }
    try {
      session = await purchase.login({ email: "", password: "" });
    } catch (e) {
      errline(e.message);
      return 1;
    }
  } else {
    for (;; ) {
      const email = await promptLine3(`correo de socio ${provider.name}: `) || "";
      const password = await promptSecret3("contrase\xF1a: ") || "";
      if (!email || !password) {
        errline("necesito correo y contrase\xF1a.");
        if (isNo(await promptLine3("\xBFreintentar? (S/n): ") || "")) {
          note2("cancelado.");
          return 0;
        }
        continue;
      }
      try {
        session = await purchase.login({ email: email.trim(), password });
        break;
      } catch (e) {
        errline(e.message);
        if (isNo(await promptLine3("\xBFreintentar? (S/n): ") || "")) {
          note2("cancelado.");
          return 0;
        }
      }
    }
  }
  note2(style2.green(`
\u2713 hola ${session?.member?.name ?? "socio"}`));
  const region = await pick("\xBFDe qu\xE9 ciudad?", await browse.regions(), (r) => r.name);
  if (!region)
    return 2;
  const movies = await browse.movies(region.id);
  let picked = null;
  while (!picked) {
    const m = await pick("\xBFQu\xE9 pel\xEDcula?", movies, (x) => x.title);
    if (!m)
      return 2;
    const showtimes = await browse.showtimes({ movieId: m.id, regionId: region.id });
    if (showtimes.length === 0) {
      note2(style2.yellow(`"${m.title}" no tiene funciones pr\xF3ximas en ${region.name}. Eleg\xED otra.`));
      continue;
    }
    const cinemas = BrowseCatalog.byCinema(showtimes);
    const cinema = await pick(`\xBFEn qu\xE9 cine? (${m.title})`, cinemas, (c) => `${c.name}  (${c.showtimes.length} funciones)`);
    if (!cinema)
      continue;
    const chosen = await pick(`\xBFQu\xE9 funci\xF3n en ${cinema.name}?`, cinema.showtimes, (st) => `${st.date} ${st.time ?? "--:--"}${st.format ? " \xB7 " + st.format : ""}`);
    if (!chosen)
      continue;
    picked = { movie: m, fn: chosen };
  }
  const { movie, fn } = picked;
  const map = await purchase.seatMap(fn, session);
  const allSeats = map.rows.flatMap((r) => r.seats);
  const perSeatPriced = allSeats.some((s) => s.priceCents != null);
  heading2(`${movie.title} \xB7 ${fn.date} ${fn.time ?? ""} \xB7 ${fn.cinemaName}`);
  note2(`${allSeats.filter((s) => s.available).length}/${allSeats.length} butacas libres`);
  paintSeatMap2(map);
  let fare;
  if (!perSeatPriced) {
    fare = defaultFare(await purchase.fares(fn, session));
    if (!fare) {
      errline("no encontr\xE9 una boleta comprable para esta funci\xF3n.");
      return 1;
    }
  }
  for (;; ) {
    const raw = await promptLine3(`
butacas (fila+n\xFAmero ej H12, o varias con coma) o 'q': `) || "";
    if (raw.toLowerCase() === "q" || !raw.trim()) {
      note2("cancelado, no se reserv\xF3 nada.");
      return 0;
    }
    const { seats, problems } = resolveSeats2(raw.split(","), map);
    if (problems.length) {
      errline(problems.join("; "));
      continue;
    }
    paintSeatMap2(map, new Set(seats.map((x) => x.label)));
    const total = perSeatPriced ? seats.reduce((sum, s) => sum + (s.priceCents ?? 0) / 100, 0) : seats.length * ((fare?.priceCents ?? 0) / 100);
    heading2("Tu selecci\xF3n");
    note2(`butacas: ${style2.cyan(seats.map((x) => x.label).join(", "))}`);
    note2(`${fare ? fare.name + " \xB7 " : ""}total ${style2.bold(fmtCOP2(total))}${perSeatPriced ? "" : " (+ cargo por servicio)"}`);
    const conf = await promptLine3("\xBFreservar y generar el pago? crea una orden real (s / N / otra para re-elegir): ") || "";
    if (conf.toLowerCase() === "n" || conf === "") {
      note2("cancelado, no se reserv\xF3 nada.");
      return 0;
    }
    if (conf.toLowerCase() !== "s" && conf.toLowerCase() !== "si")
      continue;
    const methods = purchase.paymentMethods();
    let method;
    if (methods.length) {
      method = await pick("\xBFCon qu\xE9 medio pag\xE1s?", methods, (b) => b.name) ?? undefined;
      if (!method) {
        note2("ok, sin medio de pago no genero el link. La orden no se cre\xF3.");
        return 0;
      }
    }
    note2(style2.dim(`
reservando y generando el link de pago\u2026 (el CLI no cobra; pag\xE1s vos)`));
    try {
      const { order, link } = await purchase.checkout({ session, showtime: fn, movie, regionId: region.id, seats, fare, method });
      openInBrowser2(link.url);
      heading2("\xA1Link de pago listo!");
      note2(`orden ${order.id} \xB7 ${order.seatLabels.join(", ")} \xB7 total ${style2.bold(fmtCOP2(order.total))}${method ? " \xB7 " + method.name : ""}`);
      note2(`abr\xED el pago${link.method ? ` (${link.method})` : ""} para completar (el CLI no cobra):`);
      note2("  " + style2.cyan(link.url));
      note2(style2.dim(`
tras pagar, las boletas llegan a tu correo.`));
      return 0;
    } catch (e) {
      errline(e.message);
      return 1;
    }
  }
}
async function runPortVerb(p, verb, flags, json) {
  const cmd = `${p.id} ${verb}`;
  const fail = (code, message) => {
    if (json)
      emitJson2({ ok: false, command: cmd, error: { code, message } });
    else
      errline(`${cmd}: ${message}`);
    return 1;
  };
  if (!p.purchase)
    return fail("no-purchase", `${p.name} no tiene compra por API.`);
  const purchase = new PurchaseTickets(p.purchase);
  const env = (k) => process.env[`${p.id.toUpperCase()}_${k}`];
  const email = flags.email || env("EMAIL") || "";
  const password = flags.password || env("PASSWORD") || "";
  const login3 = async () => {
    if (p.auth === "browser-assisted")
      return purchase.login({ email: "", password: "" });
    if (!email || !password)
      throw new Error(`faltan credenciales \u2014 pon\xE9 ${p.id.toUpperCase()}_EMAIL y ${p.id.toUpperCase()}_PASSWORD (o --email/--password)`);
    return purchase.login({ email: email.trim(), password });
  };
  const showtime = {
    id: flags.session,
    cinemaId: flags.cinema,
    hall: flags.hall,
    movieId: flags.movie,
    date: flags.date ?? "",
    time: flags.time
  };
  try {
    if (verb === "seats" || verb === "fares") {
      if (!flags.session || !flags.cinema)
        return fail("usage", "faltan --cinema y --session");
      const session = await login3();
      if (verb === "fares") {
        const fares = await purchase.fares(showtime, session);
        out(json, cmd, fares, [`${p.id} order --cinema ${flags.cinema} --session ${flags.session} --seats <labels>`], () => {
          heading2(`${p.name} \xB7 tarifas`);
          table2(fares.map((f) => ({ code: f.code, boleta: f.name, precio: "$" + (f.priceCents / 100).toLocaleString("es-CO") })), [{ key: "code", label: "C\xF3digo", color: style2.cyan }, { key: "boleta", label: "Boleta" }, { key: "precio", label: "Precio" }]);
        });
        return 0;
      }
      const map = await purchase.seatMap(showtime, session);
      const seats = map.rows.flatMap((r) => r.seats);
      const free = seats.filter((x) => x.available).map((x) => ({ label: x.label, priceCents: x.priceCents ?? null, special: !!x.special }));
      out(json, cmd, free, [`${p.id} order --cinema ${flags.cinema} --session ${flags.session} --seats <labels>`], () => {
        heading2(`${p.name} \xB7 butacas libres`);
        note2(`${free.length}/${seats.length} libres`);
        paintSeatMap2(map);
      });
      return 0;
    }
    if (verb === "order") {
      for (const req of ["cinema", "session", "seats"])
        if (!flags[req])
          return fail("usage", `falta --${req}`);
      const session = await login3();
      const map = await purchase.seatMap(showtime, session);
      const { seats, problems } = resolveSeats2((flags.seats || "").split(","), map);
      if (problems.length)
        return fail("seat-error", problems.join("; "));
      const perSeatPriced = map.rows.some((r) => r.seats.some((x) => x.priceCents != null));
      const fare = perSeatPriced ? undefined : defaultFare(await purchase.fares(showtime, session));
      const methods = purchase.paymentMethods();
      const method = flags.bank ? methods.find((m) => m.code === flags.bank) : methods[0];
      let title = flags.title ?? "";
      if (!title && flags.region && flags.movie) {
        try {
          title = (await new BrowseCatalog(p.catalog).movies(flags.region)).find((m) => m.id === flags.movie)?.title ?? "";
        } catch {}
      }
      const movie = { id: flags.movie ?? "", title };
      const { order, link } = await purchase.checkout({ session, showtime, movie, regionId: flags.region, seats, fare, method });
      out(json, cmd, [{ orderId: order.id, total: order.total, seats: order.seatLabels, paymentUrl: link.url, method: link.method }], [`abr\xED el link para pagar (el CLI no cobra): ${link.url}`], () => {
        heading2("\xA1Orden lista para pagar!");
        note2(`orden ${order.id} \xB7 ${order.seatLabels.join(", ")} \xB7 total $${order.total.toLocaleString("es-CO")}${link.method ? " \xB7 " + link.method : ""}`);
        note2("link de pago (el CLI no cobra):");
        note2("  " + style2.cyan(link.url));
      });
      return 0;
    }
    return fail("usage", `verbo desconocido: ${verb}`);
  } catch (e) {
    return fail("provider-error", e.message);
  }
}
function norm(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
async function searchCmd(query, cityName, json) {
  if (!query) {
    if (json)
      emitJson2({ ok: false, command: "search", error: { code: "usage", message: 'us\xE1: cinesco search "<pelicula>" --city <ciudad>' } });
    else
      errline('us\xE1: cinesco search "<pelicula>" --city <ciudad>');
    return 2;
  }
  const q = norm(query);
  const results = await Promise.all(PROVIDERS.map(async (p) => {
    try {
      const catalog = new BrowseCatalog(p.catalog);
      const regions = await catalog.regions();
      const region = cityName ? regions.find((r) => norm(r.name) === norm(cityName)) ?? regions.find((r) => norm(r.name).includes(norm(cityName))) : undefined;
      if (cityName && !region)
        return { chain: p.id, chainName: p.name, error: `sin ciudad "${cityName}"` };
      const movies = await catalog.movies(region?.id);
      const matches = movies.filter((m) => norm(m.title).includes(q)).map((m) => ({ id: m.id, title: m.title }));
      return { chain: p.id, chainName: p.name, region: region?.name, regionId: region?.id, matches };
    } catch (e) {
      return { chain: p.id, chainName: p.name, error: e.message };
    }
  }));
  const hits = results.filter((r) => ("matches" in r) && (r.matches?.length ?? 0) > 0);
  const steps = hits.flatMap((r) => r.matches.map((m) => `${r.chain} showtimes ${m.id} ${r.regionId}`));
  if (json) {
    emitJson2({ ok: true, command: "search", count: hits.length, data: results, nextSteps: steps.slice(0, 6) });
    return 0;
  }
  heading2(`Buscando "${query}"${cityName ? ` en ${cityName}` : ""}`);
  for (const r of results) {
    if (r.error) {
      note2(`${style2.cyan(r.chainName.padEnd(14))} ${style2.dim(r.error)}`);
      continue;
    }
    if (!r.matches.length) {
      note2(`${style2.cyan(r.chainName.padEnd(14))} ${style2.dim("sin resultados")}`);
      continue;
    }
    note2(`${style2.cyan(r.chainName.padEnd(14))} ${style2.green(r.matches.length + " resultado(s)")}${r.region ? " \xB7 " + r.region : ""}`);
    for (const m of r.matches)
      note2(`   ${style2.dim(m.id)}  ${m.title}   ${style2.dim(`\u2192 cinesco ${r.chain} showtimes ${m.id} ${r.regionId}`)}`);
  }
  return 0;
}
async function main() {
  const { positionals, flags, json: jsonFlag } = parseArgs(process.argv.slice(2));
  const json = jsonMode(jsonFlag);
  if (flags.version || positionals[0] === "version") {
    if (json)
      emitJson2({ ok: true, command: "version", data: { version: VERSION } });
    else
      process.stdout.write(VERSION + `
`);
    return 0;
  }
  if (positionals[0] === "logo") {
    logo2();
    return 0;
  }
  if (positionals.length === 0 || flags.help || positionals[0] === "help") {
    if (json)
      emitJson2({ ok: false, command: "", error: { code: "no-command", message: "us\xE1: cinesco providers | start | <provider> movies | schema" } });
    else {
      logo2();
      note2(`
uso: cinesco <provider> <verb> | cinesco providers | cinesco start
`);
      providersCmd(false);
      note2(`
navegaci\xF3n (ambas): regions \xB7 cinemas \xB7 movies \xB7 showtimes`);
      note2("royalfilms: " + style2.cyan("login \xB7 status \xB7 buy") + "  (buy = asistente completo)");
      note2("cinecolombia: " + style2.cyan("login \xB7 status \xB7 whoami \xB7 seatmap \xB7 reserve \xB7 cancel \xB7 checkout"));
      note2("otros: providers \xB7 doctor \xB7 skills \xB7 start \xB7 schema \xB7 logo \xB7 --json \xB7 --version");
      note2(style2.dim(`
tip: 'cinesco start' hace todo el flujo guiado (eleg\xED cadena y segu\xED).`));
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
  const p = getProvider(positionals[0]);
  if (!p) {
    const msg = `cadena desconocida: "${positionals[0]}". Prob\xE1 'cinesco providers'.`;
    if (json)
      emitJson2({ ok: false, command: positionals[0], error: { code: "unknown-provider", message: msg } });
    else
      errline(msg);
    return 2;
  }
  const verb = positionals[1];
  if (verb === "seats" || verb === "fares" || verb === "order") {
    return runPortVerb(p, verb, flags, json);
  }
  if (p.id === "royalfilms" && (verb === "payment-wait" || verb === "sales")) {
    try {
      const { token } = requireToken2();
      const doc = rfDocFromToken(token);
      if (!doc)
        throw new Error("no encontr\xE9 tu documento en la sesi\xF3n");
      if (verb === "sales") {
        const d = await apiGet2(`/ticket/document/${doc}`, token);
        const all = [...d.unredeemed ?? [], ...d.redeemed ?? []];
        if (json)
          emitJson2({ ok: true, command: "royalfilms sales", count: all.length, data: all });
        else {
          heading2("Royal Films \xB7 tus compras");
          table2(all.slice(0, 15).map((s) => ({ id: s.venta_id, fecha: String(s.venta_fecha).slice(0, 10), total: "$" + Number(s.venta_total).toLocaleString("es-CO"), cine: s.multicine?.multicine_nombre })), [
            { key: "id", label: "Venta", color: style2.cyan },
            { key: "fecha", label: "Fecha" },
            { key: "total", label: "Total" },
            { key: "cine", label: "Cine", max: 30 }
          ]);
        }
        return 0;
      }
      if (!json)
        note2("esperando el pago (aparece una venta nueva)\u2026 Ctrl-C para salir");
      const r = await rfWaitPayment(token, doc, (m) => !json && note2(m));
      if (json)
        emitJson2({ ok: true, command: "royalfilms payment-wait", data: { outcome: r.outcome, venta: r.venta } });
      else if (r.outcome === "paid") {
        heading2("\u2713 \xA1Pago confirmado!");
        note2(`venta #${r.venta.venta_id} \xB7 $${Number(r.venta.venta_total).toLocaleString("es-CO")} \xB7 las boletas est\xE1n en tu cuenta.`);
      } else
        note2(style2.yellow("no detect\xE9 el pago a tiempo. Revis\xE1 'cinesco royalfilms sales' o tu correo."));
      return 0;
    } catch (e) {
      const msg = e.message;
      if (json)
        emitJson2({ ok: false, command: `royalfilms ${verb}`, error: { code: "provider-error", message: msg } });
      else
        errline(msg);
      return 1;
    }
  }
  if (p.id === "royalfilms" && (verb === "login" || verb === "status" || verb === "buy")) {
    if (verb === "status") {
      const s = loadSession4();
      const ok = !!s && !isExpired2(s);
      if (json)
        emitJson2({ ok: true, command: "royalfilms status", data: ok ? { authenticated: true, user: s.user } : { authenticated: false } });
      else {
        heading2("Royal Films \xB7 sesi\xF3n");
        note2(ok ? `autenticado como ${s.user.correo ?? s.user.id}` : "no hay sesi\xF3n \u2014 corr\xE9 'cinesco royalfilms login'");
      }
      return 0;
    }
    if (verb === "buy") {
      const r = await runBuyWizard();
      r.human();
      return 0;
    }
    const promptLine3 = (await Promise.resolve().then(() => (init_prompt(), exports_prompt))).promptLine;
    const promptSecret3 = (await Promise.resolve().then(() => (init_prompt(), exports_prompt))).promptSecret;
    const email = flags.email || process.env.ROYALFILMS_EMAIL || await promptLine3("correo: ") || "";
    const password = flags.password || process.env.ROYALFILMS_PASSWORD || await promptSecret3("clave: ") || "";
    if (!email || !password) {
      const msg = "faltan credenciales (--email/--password, env, o terminal interactiva)";
      if (json)
        emitJson2({ ok: false, command: "royalfilms login", error: { code: "no-credentials", message: msg } });
      else
        errline(msg);
      return 2;
    }
    try {
      const sess = await login2(email, password);
      if (json)
        emitJson2({ ok: true, command: "royalfilms login", data: { user: sess.user } });
      else
        note2(`sesi\xF3n iniciada como ${sess.user.correo ?? sess.user.id}`);
      return 0;
    } catch (e) {
      const m = e.message;
      if (json)
        emitJson2({ ok: false, command: "royalfilms login", error: { code: "login-failed", message: m } });
      else
        errline(m);
      return 1;
    }
  }
  if (p.id === "cinecolombia" && (verb === "token" || verb === "login" || verb === "status" || verb === "whoami")) {
    if (verb === "status" || positionals[2] === "status") {
      const s = loadSession3();
      const data = s ? { has: true, member: !!s.memberCookie, exp: s.exp, expired: s.expired } : { has: false };
      if (json)
        emitJson2({ ok: true, command: "cinecolombia status", data });
      else {
        heading2("Sesi\xF3n de Cine Colombia");
        if (!s)
          note2("no hay sesi\xF3n. Corr\xE9 'cinesco cinecolombia token' (navegar) o 'login' (miembro).");
        else {
          note2(s.expired ? "expirada \u2014 volv\xE9 a correr token/login" : `v\xE1lida, expira ${new Date(s.exp * 1000).toLocaleString()}`);
          note2(s.memberCookie ? "sesi\xF3n de miembro: s\xED (login)" : "sesi\xF3n de miembro: no (solo navegaci\xF3n)");
        }
      }
      return 0;
    }
    if (verb === "whoami") {
      try {
        const me = await whoami2();
        if (json)
          emitJson2({ ok: true, command: "cinecolombia whoami", data: me });
        else {
          heading2("Cine Colombia \xB7 tu cuenta");
          note2(`${me.name ?? "\u2014"} \xB7 ${me.email ?? "\u2014"}`);
          note2(`id ${me.id ?? "\u2014"}${me.club ? ` \xB7 ${me.club}` : ""}`);
        }
        return 0;
      } catch (e) {
        const msg = e.message;
        if (json)
          emitJson2({ ok: false, command: "cinecolombia whoami", error: { code: "auth", message: msg } });
        else
          errline(msg);
        return 1;
      }
    }
    const wantLogin = verb === "login";
    try {
      const r = await acquireSession2(wantLogin, (s) => !json && note2(s));
      if (json)
        emitJson2({ ok: true, command: `cinecolombia ${verb}`, data: { saved: true, exp: r.exp, loggedIn: r.loggedIn } });
      else {
        heading2(wantLogin ? "Sesi\xF3n de miembro lista" : "Token de navegaci\xF3n guardado");
        note2(`expira ${new Date(r.exp * 1000).toLocaleString()}`);
        note2(r.loggedIn ? "logueado como miembro \u2713" : "solo navegaci\xF3n (para comprar us\xE1 'login')");
      }
      return 0;
    } catch (e) {
      const msg = e.message;
      if (json)
        emitJson2({ ok: false, command: `cinecolombia ${verb}`, error: { code: "session-failed", message: msg } });
      else
        errline(`no se pudo: ${msg}`);
      return 1;
    }
  }
  if (p.id === "cinecolombia" && verb === "seatmap") {
    const showtimeId = positionals[2];
    if (!showtimeId) {
      const msg = "falta el showtimeId (sale de 'showtimes' como campo id, ej 6772-11114)";
      if (json)
        emitJson2({ ok: false, command: "cinecolombia seatmap", error: { code: "usage", message: msg } });
      else
        errline(msg);
      return 2;
    }
    try {
      const s = await showtimeSeats2(showtimeId);
      if (json)
        emitJson2({ ok: true, command: "cinecolombia seatmap", data: s });
      else {
        heading2(`Funci\xF3n ${showtimeId}`);
        note2(`${s.available.length}/${s.total} butacas libres${s.isSoldOut ? " (AGOTADA)" : ""} \xB7 precio ${s.precioDefault ? "$" + s.precioDefault.toLocaleString("es-CO") : "\u2014"}`);
        paintSeats(s.seats);
        note2(`
reservar: cinesco cinecolombia reserve <siteId> ` + showtimeId + " --seats <seatId,seatId>");
      }
      return 0;
    } catch (e) {
      const msg = e.message;
      if (json)
        emitJson2({ ok: false, command: "cinecolombia seatmap", error: { code: "provider-error", message: msg } });
      else
        errline(msg);
      return 1;
    }
  }
  if (p.id === "cinecolombia" && verb === "reserve") {
    const siteId = positionals[2];
    const showtimeId = positionals[3];
    const seats = (flags.seats ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!siteId || !showtimeId || seats.length === 0) {
      const msg = "uso: cinesco cinecolombia reserve <siteId> <showtimeId> --seats <seatId,seatId> [--confirm]";
      if (json)
        emitJson2({ ok: false, command: "cinecolombia reserve", error: { code: "usage", message: msg } });
      else
        errline(msg);
      return 2;
    }
    if (!flags.confirm) {
      const data = { dryRun: true, siteId, showtimeId, seats, wouldSend: { booking: { siteId, bookingMode: "Paid" }, showtime: { seats, tickets: [] } } };
      if (json)
        emitJson2({ ok: true, command: "cinecolombia reserve", data });
      else {
        heading2("Reserva Cine Colombia (dry-run)");
        note2(`butacas ${seats.join(", ")} en funci\xF3n ${showtimeId} (cine ${siteId})`);
        note2(style2.yellow("esto NO reserv\xF3 nada. Agreg\xE1 --confirm para crear la orden (retiene butacas reales)."));
      }
      return 0;
    }
    try {
      const r = await reserveViaBrowser(siteId, showtimeId, seats, (m) => !json && note2(m));
      const payUrl = paymentUrl();
      if (json)
        emitJson2({ ok: true, command: "cinecolombia reserve", data: { orderId: r.orderId, seats, total: r.total, paymentUrl: payUrl, willCharge: false }, nextSteps: [`open "${payUrl}"`, `cinesco cinecolombia cancel ${r.orderId}`] });
      else {
        heading2("Butacas retenidas (Cine Colombia)");
        note2(`orden ${r.orderId} \xB7 butacas ${seats.join(", ")}${r.total ? " \xB7 total $" + r.total.toLocaleString("es-CO") : ""}`);
        note2(style2.yellow(`
Para pagar: abr\xED ` + style2.cyan(payUrl) + " en el navegador (logueado). El CLI no cobra."));
        note2(style2.dim(`si te arrepent\xEDs: cinesco cinecolombia cancel ${r.orderId}`));
      }
      return 0;
    } catch (e) {
      const msg = e.message;
      if (json)
        emitJson2({ ok: false, command: "cinecolombia reserve", error: { code: "provider-error", message: msg } });
      else
        errline(msg);
      return 1;
    }
  }
  if (p.id === "cinecolombia" && verb === "cancel") {
    const orderId = positionals[2];
    if (!orderId) {
      if (json)
        emitJson2({ ok: false, command: "cinecolombia cancel", error: { code: "usage", message: "falta el orderId" } });
      else
        errline("falta el orderId");
      return 2;
    }
    try {
      await cancelViaBrowser(orderId, (m) => !json && note2(m));
      if (json)
        emitJson2({ ok: true, command: "cinecolombia cancel", data: { cancelled: orderId } });
      else
        note2(`orden ${orderId} liberada`);
      return 0;
    } catch (e) {
      const msg = e.message;
      if (json)
        emitJson2({ ok: false, command: "cinecolombia cancel", error: { code: "provider-error", message: msg } });
      else
        errline(msg);
      return 1;
    }
  }
  if (p.id === "cinecolombia" && verb === "checkout") {
    const siteId = positionals[2];
    const showtimeId = positionals[3];
    const seats = (flags.seats ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!siteId || !showtimeId || seats.length === 0) {
      const msg = "uso: cinesco cinecolombia checkout <siteId> <showtimeId> --seats <seatId,seatId>";
      if (json)
        emitJson2({ ok: false, command: "cinecolombia checkout", error: { code: "usage", message: msg } });
      else
        errline(msg);
      return 2;
    }
    try {
      const co = await checkoutViaBrowser2(siteId, showtimeId, seats, (m) => !json && note2(m));
      if (!json)
        openInBrowser2(co.paymentUrl);
      let outcome;
      if (flags.wait) {
        if (!json)
          note2(`
esperando el pago (Ctrl-C para salir)\u2026`);
        outcome = await ccWaitPayment(co.orderId, (m) => !json && note2(m));
      }
      if (json)
        emitJson2({ ok: true, command: "cinecolombia checkout", data: { ...co, willCharge: false, outcome }, nextSteps: [`open "${co.paymentUrl}"`, `cinesco cinecolombia cancel ${co.orderId}`] });
      else {
        heading2("Orden lista para pagar");
        note2(`orden ${co.orderId}${co.total ? " \xB7 total $" + co.total.toLocaleString("es-CO") : ""}`);
        note2("link de pago (PlacetoPay), intent\xE9 abrirlo:");
        note2("  " + style2.cyan(co.paymentUrl));
        if (outcome === "paid")
          note2(style2.green(`
\u2713 pago confirmado \u2014 las boletas van a tu correo.`));
        else if (outcome === "cancelled")
          note2(style2.red(`
la orden se cancel\xF3/expir\xF3 sin pago.`));
        else if (outcome === "timeout")
          note2(style2.yellow(`
no detect\xE9 el pago a tiempo; revis\xE1 tu correo o el estado con 'order-status'.`));
        else {
          note2(style2.yellow("el CLI no cobra; complet\xE1 el pago ah\xED."));
          note2(style2.dim(`estado: cinesco cinecolombia order-status ${co.orderId}  \xB7  cancelar: cinesco cinecolombia cancel ${co.orderId}`));
        }
      }
      return 0;
    } catch (e) {
      const msg = e.message;
      if (json)
        emitJson2({ ok: false, command: "cinecolombia checkout", error: { code: "provider-error", message: msg } });
      else
        errline(msg);
      return 1;
    }
  }
  if (p.id === "cinecolombia" && verb === "order-status") {
    const orderId = positionals[2];
    if (!orderId) {
      if (json)
        emitJson2({ ok: false, command: "cinecolombia order-status", error: { code: "usage", message: "falta el orderId" } });
      else
        errline("falta el orderId");
      return 2;
    }
    try {
      if (flags.wait) {
        const outcome = await ccWaitPayment(orderId, (m) => !json && note2(m));
        if (json)
          emitJson2({ ok: true, command: "cinecolombia order-status", data: { orderId, outcome } });
        else
          note2(outcome === "paid" ? style2.green("\u2713 pagado") : outcome === "cancelled" ? style2.red("cancelada/expirada") : style2.yellow("sin confirmar (timeout)"));
        return 0;
      }
      const st = await orderStatusViaBrowser(orderId, (m) => !json && note2(m));
      if (json)
        emitJson2({ ok: true, command: "cinecolombia order-status", data: { orderId, ...st } });
      else {
        heading2(`Orden ${orderId}`);
        if (!st.exists)
          note2("no existe (cancelada o expirada)");
        else
          note2(`${st.paid ? style2.green("pagada \u2713") : "pendiente de pago"} \xB7 estado ${st.status}${st.total ? " \xB7 $" + st.total.toLocaleString("es-CO") : ""}`);
      }
      return 0;
    } catch (e) {
      const msg = e.message;
      if (json)
        emitJson2({ ok: false, command: "cinecolombia order-status", error: { code: "provider-error", message: msg } });
      else
        errline(msg);
      return 1;
    }
  }
  if (!verb) {
    if (json)
      emitJson2({ ok: false, command: p.id, error: { code: "no-verb", message: "falta verbo: regions | cinemas | movies | showtimes" } });
    else
      errline(`${p.id}: falta verbo (regions | cinemas | movies | showtimes)`);
    return 2;
  }
  return runProviderVerb(p, verb, positionals.slice(2), flags, json);
}
main().then((code) => {
  process.exitCode = code;
}).catch((e) => {
  process.stderr.write(`fatal: ${e.message}
`);
  process.exitCode = 1;
});
