#!/usr/bin/env node
// @bun

// src/shared/proc.ts
import { spawn, spawnSync } from "node:child_process";
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function launch(cmd, args) {
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {}
}

// src/infrastructure/royalfilms/api.ts
var BASE = "https://cinemasroyalfilms.com/api";
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
  const url = `${BASE}${path}`;
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
  const url = `${BASE}${path}`;
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
async function apiDelete(path, token) {
  const url = `${BASE}${path}`;
  let res;
  try {
    res = await fetch(url, { method: "DELETE", headers: authHeaders(token) });
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
function clearSession() {
  if (!existsSync(FILE))
    return false;
  rmSync(FILE);
  return true;
}
function isExpired(session, skewSeconds = 30) {
  if (!session.exp)
    return false;
  return Date.now() / 1000 >= session.exp - skewSeconds;
}
function sessionFilePath() {
  return FILE;
}

// src/infrastructure/royalfilms/auth.ts
async function login(email, password) {
  const token = await apiPost(`/auth/login`, { email, password });
  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new ApiError("bad-login", "el login no devolvió un token válido");
  }
  return saveSession(token);
}
function requireToken() {
  const session = loadSession();
  if (!session) {
    throw new ApiError("not-authenticated", "no hay sesión — corré 'royalfilms auth login'");
  }
  if (isExpired(session)) {
    throw new ApiError("session-expired", "la sesión expiró — corré 'royalfilms auth login'");
  }
  return { token: session.token, session };
}

// src/shared/prompt.ts
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
function releaseReserve(reservaId, token) {
  return apiDelete(`/reserve/ticket-office/${reservaId}`, token);
}

// src/infrastructure/royalfilms/audit.ts
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
import { mkdirSync as mkdirSync2, appendFileSync, chmodSync as chmodSync2 } from "node:fs";
var DIR2 = join2(homedir2(), ".royalfilms", "audit");
function today() {
  return new Date().toISOString().slice(0, 10);
}
function write(record) {
  mkdirSync2(DIR2, { recursive: true });
  const file = join2(DIR2, `${today()}.jsonl`);
  appendFileSync(file, JSON.stringify(record) + `
`, { mode: 384 });
  try {
    chmodSync2(file, 384);
  } catch {}
}
var counter = 0;
function newId() {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}
function auditPending(action, request) {
  const id = newId();
  write({ id, ts: new Date().toISOString(), action, phase: "pending", request });
  return {
    id,
    final(outcome, detail) {
      write({ id, ts: new Date().toISOString(), action, phase: "final", outcome, detail });
    }
  };
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

// src/presentation/commands.ts
import { homedir as homedir3 } from "node:os";
import { join as join3 } from "node:path";
import { writeFileSync as writeFileSync2 } from "node:fs";
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
    launch(cmd, [path]);
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
  const htmlPath = join3(homedir3(), ".royalfilms", `pago-${invoiceRef}.html`);
  writeFileSync2(htmlPath, buildCheckoutHtml(sessionId, fmtCOP(amount)), { mode: 384 });
  return { sessionId, htmlPath };
}
var num = (label, v) => {
  if (!/^\d+$/.test(v))
    throw new UsageError(`${label} debe ser numérico, recibí "${v}"`);
  return v;
};

class UsageError extends Error {
}
var asRows = (d) => Array.isArray(d) ? d : d ? [d] : [];
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
    const i = await promptSelect(title, items.map(label));
    if (i === null)
      throw new UsageError("selección cancelada");
    return items[i];
  };
  const countries = await apiGet(`/countries`);
  const country = await pick("¿De qué país sos?", countries, (c) => String(c.pais_nombre));
  const cities = (await apiGet(`/cities`)).filter((c) => c.pais_id === country.pais_id);
  const city = await pick("¿De qué ciudad?", cities, (c) => String(c.ciudad_nombre));
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
    const email = await promptLine("correo: ") || "";
    const password = await promptSecret("clave: ") || "";
    if (!email || !password)
      throw new UsageError("faltan credenciales");
    sess = await login(email, password);
  }
  const token = sess.token;
  const map = await apiGet(`/cinemas/halls/id/${fn.funcion_sala_id}/function/id/${fn.funcion_id}/channel/id/1/user/id/${sess.user.id}`, token);
  const typeNames = await fetchTypeNames(token);
  const sum = summarize(map, typeNames);
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
    const ans = await promptLine(`
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
  const conf = await promptLine("¿reservar estas butacas? (s/N): ") || "";
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
  const wantPay = await promptLine("¿crear la venta y generar el pago de ePayco? (s/N): ") || "";
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
          typeNames,
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
          await sleep(5000);
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
var COMMANDS = [
  {
    noun: "buy",
    verb: "start",
    args: [],
    summary: "Asistente interactivo: país → ciudad → película → fecha → función → butacas → reserva",
    run: () => runBuyWizard()
  },
  {
    noun: "auth",
    verb: "login",
    args: [],
    flags: [
      { name: "email", desc: "correo (o env ROYALFILMS_EMAIL, o se pregunta)" },
      { name: "password", desc: "clave (o env ROYALFILMS_PASSWORD, o se pregunta sin eco)" }
    ],
    summary: "Iniciar sesión y guardar el token localmente",
    async run(_pos, flags) {
      const email = flags.email || process.env.ROYALFILMS_EMAIL || await promptLine("correo: ") || "";
      const password = flags.password || process.env.ROYALFILMS_PASSWORD || await promptSecret("clave: ") || "";
      if (!email || !password) {
        throw new UsageError("faltan credenciales: pasá --email/--password, definí ROYALFILMS_EMAIL/ROYALFILMS_PASSWORD, o corré en una terminal interactiva");
      }
      const session = await login(email, password);
      return {
        data: { user: session.user, exp: session.exp },
        nextSteps: ["auth status", "seats <funcionId> <salaId>"],
        human() {
          heading("Sesión iniciada");
          note(`hola ${session.user.nombres ?? ""} ${session.user.apellidos ?? ""}`.trim());
          note(`token guardado en ${sessionFilePath()} (solo lectura del dueño)`);
        }
      };
    }
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
        data: authenticated ? { authenticated, user: s.user, exp: s.exp, expired: false } : { authenticated: false, expired: !!s },
        human() {
          heading("Sesión");
          if (!s)
            note("no hay sesión — corré 'royalfilms auth login'");
          else if (isExpired(s))
            note("la sesión expiró — corré 'royalfilms auth login'");
          else {
            note(`autenticado como ${s.user.correo ?? s.user.id}`);
            note(`expira: ${new Date(s.exp * 1000).toLocaleString()}`);
          }
        }
      };
    }
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
        }
      };
    }
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
      const map = await apiGet(path, token);
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
          note(`${sum.disponibles} libres · ${sum.ocupadas} ocupadas · máx ${sum.maxPorCompra} por compra`);
          paintSeatMap(map);
          note(`
precio por tipo:`);
          note(tierLines(sum));
          const libres = map.mapa_sala.filter((c) => c.silla_disponible).slice(0, 12).map((c) => `${c.mapa_sala_numero_silla}(${c.silla_id})`);
          note(`
algunas libres: ` + libres.join("  ·  "));
        }
      };
    }
  },
  {
    noun: "reserve",
    verb: "hold",
    args: ["funcionId", "salaId", "multicineId"],
    flags: [
      { name: "seats", desc: "butacas por etiqueta o silla_id, separadas por coma: F17,F16 o 1,2" },
      { name: "confirm", desc: "ejecutar la reserva real (por defecto es dry-run)" }
    ],
    summary: "Retener butacas de una función (dry-run por defecto; retiene inventario real)",
    async run(pos, flags) {
      const fn = Number(num("funcionId", pos[0]));
      const sala = Number(num("salaId", pos[1]));
      const mc = Number(num("multicineId", pos[2]));
      if (!flags.seats)
        throw new UsageError("faltan butacas: pasá --seats F17,F16 (etiquetas o ids)");
      const { token, session } = requireToken();
      const map = await apiGet(`/cinemas/halls/id/${sala}/function/id/${fn}/channel/id/1/user/id/${session.user.id}`, token);
      const byId = new Map(map.mapa_sala.map((c) => [c.silla_id, c]));
      const resolved = resolveSeats(String(flags.seats).split(","), map.mapa_sala);
      const seats = resolved.seats;
      if (resolved.problems.length)
        throw new UsageError(resolved.problems.join("; "));
      if (seats.length === 0)
        throw new UsageError("no se resolvió ninguna butaca válida");
      if (seats.length > map.configuracion_general.cantidad_max_sillas)
        throw new UsageError(`máximo ${map.configuracion_general.cantidad_max_sillas} butacas por compra`);
      const body = buildReserveBody(fn, mc, sala, seats);
      const total = seats.reduce((a, s) => a + (seatPrice(byId.get(s.id)) ?? 0), 0);
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
          }
        };
      }
      const audit = auditPending("reserve.hold", { body, seats });
      try {
        const res = await reserve(body, token);
        audit.final("ok", { reserva_silla_id: res.reserve?.reserva_silla_id });
        return {
          data: { dryRun: false, reserve: res.reserve, seats, total, auditId: audit.id },
          nextSteps: [
            `reserve release ${res.reserve.reserva_silla_id}`,
            "completá el pago en https://cinemasroyalfilms.com (el CLI no cobra)"
          ],
          human() {
            heading("Butacas retenidas");
            note(`reserva #${res.reserve.reserva_silla_id} · ${seats.map((s) => s.numero).join(", ")} · ${fmtCOP(total)}`);
            note(`la retención expira en ~${map.configuracion_general.duracion_tiempo_transaccion} min.`);
            note("liberá con: reserve release " + res.reserve.reserva_silla_id);
            note(style.yellow("para pagar, completá la compra en el sitio web — el CLI no procesa el pago."));
          }
        };
      } catch (e) {
        audit.final("error", { message: e.message });
        throw e;
      }
    }
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
          }
        };
      } catch (e) {
        audit.final("error", { message: e.message });
        throw e;
      }
    }
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
      if (!flags.seats)
        throw new UsageError("faltan butacas: pasá --seats 1,2,3");
      const ids = String(flags.seats).split(",").map((s) => Number(num("--seats", s.trim())));
      const { token, session } = requireToken();
      const map = await apiGet(`/cinemas/halls/id/${sala}/function/id/${fn}/channel/id/1/user/id/${session.user.id}`, token);
      const byId = new Map(map.mapa_sala.map((c) => [c.silla_id, c]));
      const seats = ids.map((id) => {
        const c = byId.get(id);
        if (!c)
          throw new UsageError(`silla ${id} no existe en esta sala`);
        return { id, numero: c.mapa_sala_numero_silla, precio: seatPrice(c) ?? 0 };
      });
      const total = seats.reduce((a, s) => a + s.precio, 0);
      const ventaWouldBe = {
        venta_usuario_id: session.user.id,
        venta_ciudad: session.user.ciudad ?? null,
        venta_total: total,
        venta_canal_venta: 5,
        venta_multicine: mc,
        venta_observaciones: "Venta en pagina web",
        boxOffice: { funcion: fn, sala, sillas: seats.map((s) => ({ id: s.id, numero: s.numero })) },
        _nota: "campos como venta_metodo_pago, venta_usuario_invitado y el detalle de boxOffice no están verificados"
      };
      const payUrl = "https://cinemasroyalfilms.com";
      return {
        data: {
          willCharge: false,
          seats,
          total,
          sale_body_preview: ventaWouldBe,
          pay_at: payUrl
        },
        nextSteps: [`reserve hold ${fn} ${sala} ${mc} --seats ${seats.map((s) => s.numero).join(",")} --confirm`],
        human() {
          heading("Resumen de compra (preview)");
          note(`butacas: ${seats.map((s) => `${s.numero} ${fmtCOP(s.precio)}`).join(" · ")}`);
          note(`total: ${style.bold(fmtCOP(total))}`);
          note(style.yellow(`
El CLI no procesa el pago (sería un cobro real por ePayco con un payload no verificado).`));
          note(`Para pagar: reservá las butacas (reserve hold ... --confirm) y completá la compra en ${style.cyan(payUrl)} con tu sesión.`);
          note(style.dim(`
body de venta que el sitio armaría (referencia): ` + JSON.stringify(ventaWouldBe)));
        }
      };
    }
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
      if (!flags.seats)
        throw new UsageError("faltan butacas: pasá --seats F17,F16");
      const { token, session } = requireToken();
      const map = await apiGet(`/cinemas/halls/id/${sala}/function/id/${fn}/channel/id/1/user/id/${session.user.id}`, token);
      const resolved = resolveSeats(String(flags.seats).split(","), map.mapa_sala);
      if (resolved.problems.length)
        throw new UsageError(resolved.problems.join("; "));
      const byId = new Map(map.mapa_sala.map((c) => [c.silla_id, c]));
      const total = resolved.seats.reduce((a, s) => a + (seatPrice(byId.get(s.id)) ?? 0), 0);
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
          note(`
intenté abrir el formulario de ePayco en el navegador:`);
          note("  " + style.bold(htmlPath));
          note(style.dim(`  (si no se abrió: open "${htmlPath}")`));
          note(style.yellow(`
No se creó ninguna orden ni se cobró nada. El pago solo ocurre si lo confirmás en ePayco.`));
        }
      };
    }
  },
  {
    noun: "cities",
    verb: "list",
    args: [],
    summary: "Listar todas las ciudades",
    async run() {
      const data = await apiGet(`/cities`);
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
            { key: "pais_id", label: "País" }
          ]);
        }
      };
    }
  },
  {
    noun: "countries",
    verb: "list",
    args: [],
    summary: "Listar países",
    async run() {
      const data = await apiGet(`/countries`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        nextSteps: ["identity-types by-country <countryId>"],
        human() {
          heading(`Países (${rows.length})`);
          table(rows, [
            { key: "pais_id", label: "ID", color: style.cyan },
            { key: "pais_nombre", label: "País" }
          ]);
        }
      };
    }
  },
  {
    noun: "city",
    verb: "get",
    args: ["cityId"],
    summary: "Detalle de una ciudad por su ID",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet(`/cities/${city}`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        nextSteps: [`cinemas by-city ${city}`, `billboard by-city ${city}`],
        human() {
          heading(`Ciudad ${city}`);
          if (rows.length === 0)
            note("(el endpoint devolvió vacío para esta ciudad)");
          else
            table(rows, [
              { key: "ciudad_id", label: "ID", color: style.cyan },
              { key: "ciudad_nombre", label: "Ciudad" },
              { key: "pais_id", label: "País" }
            ]);
        }
      };
    }
  },
  {
    noun: "cinemas",
    verb: "by-city",
    args: ["cityId"],
    summary: "Listar cines (multicines) de una ciudad",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet(`/cinemas/city/${city}`);
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
            { key: "multicine_telefono", label: "Teléfono" }
          ]);
        }
      };
    }
  },
  {
    noun: "billboard",
    verb: "by-city",
    args: ["cityId"],
    flags: [{ name: "cinema", desc: "filtrar por multicineId" }],
    summary: "Cartelera (en cartel) de una ciudad, opcionalmente por cine",
    async run(pos, flags) {
      const city = num("cityId", pos[0]);
      const path = flags.cinema ? `/billboard/city/${city}/cinema/${num("--cinema", flags.cinema)}` : `/billboard/city/${city}`;
      const data = await apiGet(path);
      const rows = asRows(data);
      const flat = rows.map((r) => {
        const p = r.pelicula ?? {};
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
            { key: "original", label: "Original", max: 34 }
          ]);
        }
      };
    }
  },
  {
    noun: "billboard",
    verb: "coming-soon",
    args: ["cityId"],
    summary: "Próximos estrenos de una ciudad",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet(`/billboard/comingSoon/city/${city}`);
      const rows = asRows(data);
      const flat = rows.map((r) => {
        const p = r.pelicula ?? {};
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
            { key: "original", label: "Original", max: 34 }
          ]);
        }
      };
    }
  },
  {
    noun: "movie",
    verb: "by-city",
    args: ["movieId", "cityId"],
    summary: "Detalle de una película en una ciudad",
    async run(pos) {
      const m = num("movieId", pos[0]);
      const c = num("cityId", pos[1]);
      const data = await apiGet(`/movies/id/${m}/city/${c}`);
      const p = data?.pelicula ?? data;
      return {
        data,
        nextSteps: [`showtimes by-city ${m} ${c}`],
        human() {
          heading(`Película ${m} · ciudad ${c}`);
          note(`${p.pelicula_nombre_formato ?? ""}`);
          note(`original: ${p.pelicula_nombre_original ?? "—"}`);
        }
      };
    }
  },
  {
    noun: "movie",
    verb: "by-cinema",
    args: ["movieId", "cinemaId"],
    summary: "Detalle de una película en un cine",
    async run(pos) {
      const m = num("movieId", pos[0]);
      const c = num("cinemaId", pos[1]);
      const data = await apiGet(`/movies/id/${m}/cinema/${c}`);
      const p = data?.pelicula ?? data;
      return {
        data,
        human() {
          heading(`Película ${m} · cine ${c}`);
          note(`${p.pelicula_nombre_formato ?? ""}`);
          note(`original: ${p.pelicula_nombre_original ?? "—"}`);
        }
      };
    }
  },
  {
    noun: "showtimes",
    verb: "by-city",
    args: ["movieId", "cityId"],
    summary: "Funciones/horarios de una película en una ciudad",
    async run(pos) {
      const m = num("movieId", pos[0]);
      const c = num("cityId", pos[1]);
      const data = await apiGet(`/movies/functions/${m}/city/${c}`);
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
            { key: "funcion_sala_id", label: "Sala" }
          ]);
        }
      };
    }
  },
  {
    noun: "services",
    verb: "by-city",
    args: ["cityId"],
    summary: "Formatos/servicios premium (VIP, etc.) de una ciudad",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet(`/service/getFromCity/${city}`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Servicios ciudad ${city} (${rows.length})`);
          table(rows, [
            { key: "servicio_id", label: "ID", color: style.cyan },
            { key: "servicio_nombre", label: "Servicio" }
          ]);
        }
      };
    }
  },
  {
    noun: "banners",
    verb: "by-city",
    args: ["cityId"],
    summary: "Banners publicitarios de una ciudad",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet(`/advertising/banners/city/${city}`);
      const banners = asRows(data?.banners ?? data);
      return {
        data,
        count: banners.length,
        human() {
          heading(`Banners ciudad ${city} (${banners.length})`);
          table(banners, [
            { key: "publicidad_banner_id", label: "ID", color: style.cyan },
            { key: "imagen_publicidad_banner_s3", label: "Imagen", max: 50 },
            { key: "orden_publicidad_banner", label: "Orden" }
          ]);
        }
      };
    }
  },
  {
    noun: "popups",
    verb: "by-city",
    args: ["cityId"],
    summary: "Popups publicitarios de una ciudad",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet(`/advertising/popups/city/${city}`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Popups ciudad ${city} (${rows.length})`);
          table(rows, [{ key: "publicidad_popups_id", label: "ID", color: style.cyan }]);
        }
      };
    }
  },
  {
    noun: "promotions",
    verb: "list",
    args: [],
    summary: "Listar promociones",
    async run() {
      const data = await apiGet(`/advertising/promotions`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Promociones (${rows.length})`);
          table(rows, [{ key: "publicidad_promociones_id", label: "ID", color: style.cyan }]);
        }
      };
    }
  },
  {
    noun: "payment-methods",
    verb: "by-city",
    args: ["cityId"],
    summary: "Medios de pago de una ciudad",
    async run(pos) {
      const city = num("cityId", pos[0]);
      const data = await apiGet(`/paymentMethods/${city}`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Medios de pago ciudad ${city} (${rows.length})`);
          table(rows, [
            { key: "medio_pago_id", label: "ID", color: style.cyan },
            { key: "medio_pago_descripcion", label: "Medio" }
          ]);
        }
      };
    }
  },
  {
    noun: "identity-types",
    verb: "list",
    args: [],
    summary: "Tipos de documento de identidad (con regex de validación)",
    async run() {
      const data = await apiGet(`/identity/allTypes`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Tipos de identidad (${rows.length})`);
          table(rows, [
            { key: "tipo_identificacion_id", label: "ID", color: style.cyan },
            { key: "tipo_identificacion_nombre", label: "Nombre" },
            { key: "tipo_identificacion_regex", label: "Regex", max: 30 }
          ]);
        }
      };
    }
  },
  {
    noun: "identity-types",
    verb: "by-country",
    args: ["countryId"],
    summary: "Tipos de documento válidos en un país",
    async run(pos) {
      const country = num("countryId", pos[0]);
      const data = await apiGet(`/identity/byCountry/${country}`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Tipos de identidad · país ${country} (${rows.length})`);
          table(rows, [
            { key: "tipo_identificacion_id", label: "ID", color: style.cyan },
            { key: "tipo_identificacion_nombre", label: "Nombre" }
          ]);
        }
      };
    }
  },
  {
    noun: "products",
    verb: "list",
    args: [],
    summary: "Productos del canal/cine por defecto (channel 1, cinema 1)",
    async run() {
      const data = await apiGet(`/products/channel/1/cinema/1`);
      const rows = asRows(data);
      return {
        data,
        count: rows.length,
        human() {
          heading(`Productos (${rows.length})`);
          table(rows, [{ key: "producto_id", label: "ID", color: style.cyan }]);
        }
      };
    }
  }
];
function findCommand(noun, verb) {
  return COMMANDS.find((c) => c.noun === noun && c.verb === verb);
}

// src/infrastructure/royalfilms/api.ts
class ApiError2 extends Error {
  code;
  httpStatus;
  constructor(code, message, httpStatus) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
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
function emitJson(env) {
  process.stdout.write(JSON.stringify(env, null, stdoutIsTTY2 ? 2 : 0) + `
`);
}
function banner() {
  if (!stdoutIsTTY2)
    return;
  process.stderr.write(style2.bold(style2.magenta("Royal Films")) + style2.dim(` · cartelera desde la terminal
`));
}
var LOGO2 = [
  "██████╗  ██████╗ ██╗   ██╗ █████╗ ██╗",
  "██╔══██╗██╔═══██╗╚██╗ ██╔╝██╔══██╗██║",
  "██████╔╝██║   ██║ ╚████╔╝ ███████║██║",
  "██╔══██╗██║   ██║  ╚██╔╝  ██╔══██║██║",
  "██║  ██║╚██████╔╝   ██║   ██║  ██║███████╗",
  "╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚══════╝"
];
var STRIP2 = "▐▌ ".repeat(14).trimEnd();
function logo2(toStdout = false) {
  const out = toStdout ? process.stdout : process.stderr;
  if (!toStdout && !stdoutIsTTY2)
    return;
  out.write(`
` + style2.dim(STRIP2) + `
`);
  for (const line of LOGO2)
    out.write(style2.bold(style2.magenta(line)) + `
`);
  out.write(style2.cyan("       F I L M S") + style2.dim("   ·   cine en tu terminal") + `
`);
  out.write(style2.dim(STRIP2) + `
`);
}
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

// src/presentation/cli.ts
var VERSION = "0.1.0";
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  let json = false;
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      json = true;
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const eq = key.indexOf("=");
      if (eq >= 0) {
        flags[key.slice(0, eq)] = key.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[key] = argv[++i];
      } else {
        flags[key] = "true";
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags, json };
}
function printHelp() {
  note2(style2.bold("royalfilms") + ` \u2014 cartelera de Royal Films (API p\xFAblica) desde la terminal
`);
  note2(style2.dim(`uso: royalfilms <noun> <verb> [args] [--flags] [--json]
`));
  const byNoun = new Map;
  for (const c of COMMANDS) {
    if (!byNoun.has(c.noun))
      byNoun.set(c.noun, []);
    byNoun.get(c.noun).push(c);
  }
  for (const [noun, cmds] of byNoun) {
    process.stderr.write(style2.cyan(noun) + `
`);
    for (const c of cmds) {
      const sig = [c.verb, ...c.args.map((a) => `<${a}>`)].join(" ");
      const flagsig = c.flags?.length ? " " + c.flags.map((f) => `[--${f.name}]`).join(" ") : "";
      process.stderr.write("  " + style2.bold(sig + flagsig).padEnd(46) + style2.dim(c.summary) + `
`);
    }
  }
  process.stderr.write(`
` + style2.cyan("otros") + `
  ` + style2.bold("logo").padEnd(28) + style2.dim(`mostrar el logotipo
  `) + style2.bold("schema").padEnd(28) + style2.dim(`contrato de comandos como JSON
  `) + style2.bold("--version").padEnd(28) + style2.dim(`versi\xF3n
  `) + style2.bold("--help").padEnd(28) + style2.dim(`esta ayuda
`));
}
function schema(json) {
  const spec = {
    name: "royalfilms",
    version: VERSION,
    schemaVersion: 1,
    base: "https://cinemasroyalfilms.com/api",
    envelope: {
      ok: "boolean",
      command: "string",
      count: "number?",
      data: "unknown",
      error: "{code,message}?",
      nextSteps: "string[]?"
    },
    exitCodes: { "0": "success", "1": "api or network failure", "2": "usage error" },
    commands: COMMANDS.map((c) => ({
      command: `${c.noun} ${c.verb}`,
      args: c.args,
      flags: (c.flags ?? []).map((f) => ({ name: f.name, description: f.desc })),
      summary: c.summary
    }))
  };
  if (json) {
    emitJson({ ok: true, command: "schema", data: spec });
  } else {
    heading2(`royalfilms schema v${spec.schemaVersion} (cli ${VERSION})`);
    table2(spec.commands.map((c) => ({ command: c.command, args: c.args.join(" "), summary: c.summary })), [
      { key: "command", label: "Comando", color: style2.cyan },
      { key: "args", label: "Args" },
      { key: "summary", label: "Descripci\xF3n", max: 44 }
    ]);
  }
}
async function main() {
  const argv = process.argv.slice(2);
  const { positionals, flags, json: jsonFlag } = parseArgs(argv);
  const json = jsonMode(jsonFlag);
  if (flags.version || positionals[0] === "version") {
    if (json)
      emitJson({ ok: true, command: "version", data: { version: VERSION } });
    else
      process.stdout.write(VERSION + `
`);
    return 0;
  }
  const helpRequested = flags.help || positionals[0] === "help";
  const bareInvoke = positionals.length === 0 && !helpRequested;
  if (helpRequested || bareInvoke) {
    if (json) {
      if (bareInvoke) {
        emitJson({
          ok: false,
          command: "",
          error: { code: "no-command", message: "falta un comando \u2014 corr\xE9 'schema --json' para ver el contrato" }
        });
      } else {
        emitJson({ ok: true, command: "help", data: { hint: "run: schema --json" } });
      }
    } else {
      logo2();
      printHelp();
    }
    return bareInvoke ? 2 : 0;
  }
  if (positionals[0] === "logo") {
    if (json)
      emitJson({ ok: true, command: "logo", data: { name: "ROYAL FILMS", subtitle: "cine en tu terminal" } });
    else
      logo2(true);
    return 0;
  }
  if (positionals[0] === "schema") {
    schema(json);
    return 0;
  }
  const [noun, verb, ...rest] = positionals;
  const cmd = findCommand(noun, verb);
  if (!cmd) {
    const attempted = `${noun} ${verb ?? ""}`.trim();
    const msg = `comando desconocido: "${attempted}" \u2014 prob\xE1 'royalfilms schema'`;
    if (json)
      emitJson({ ok: false, command: `${noun} ${verb ?? ""}`.trim(), error: { code: "unknown-command", message: msg } });
    else
      errline(msg);
    return 2;
  }
  const commandName = `${cmd.noun} ${cmd.verb}`;
  if (rest.length < cmd.args.length) {
    const msg = `faltan argumentos: se esperaban ${cmd.args.map((a) => `<${a}>`).join(" ")}`;
    if (json)
      emitJson({ ok: false, command: commandName, error: { code: "missing-args", message: msg } });
    else
      errline(`${commandName}: ${msg}`);
    return 2;
  }
  if (!json)
    banner();
  try {
    const result = await cmd.run(rest, flags);
    if (json) {
      emitJson({
        ok: true,
        command: commandName,
        count: result.count,
        data: result.data,
        nextSteps: result.nextSteps
      });
    } else {
      result.human();
      if (result.nextSteps?.length) {
        note2(`
siguiente: ` + result.nextSteps.map((s) => style2.dim(s)).join("  \xB7  "));
      }
    }
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      if (json)
        emitJson({ ok: false, command: commandName, error: { code: "usage", message: e.message } });
      else
        errline(`${commandName}: ${e.message}`);
      return 2;
    }
    if (e instanceof ApiError2) {
      if (json)
        emitJson({ ok: false, command: commandName, error: { code: e.code, message: e.message } });
      else
        errline(`${commandName}: ${e.message}`);
      return 1;
    }
    const msg = e.message ?? String(e);
    if (json)
      emitJson({ ok: false, command: commandName, error: { code: "internal", message: msg } });
    else
      errline(`${commandName}: ${msg}`);
    return 1;
  }
}
main().then((code) => {
  process.exitCode = code;
}).catch((e) => {
  process.stderr.write(`fatal: ${e.message}
`);
  process.exitCode = 1;
});
