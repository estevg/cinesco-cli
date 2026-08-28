// `cinesco doctor` — what's installed, what's missing, and the command that fixes it.
// Agent-first: an agent runs this first to learn which chains it can drive right now.
import { emitJson, heading, table, style, note } from "../shared/output.ts";
import { loadSession as rfLoad, isExpired as rfExpired } from "../infrastructure/royalfilms/session.ts";
import { loadSession as ccLoad } from "../infrastructure/cinecolombia/cinecolombia-token.ts";

interface Check {
  check: string;
  status: "ok" | "missing" | "stale";
  detail: string;
  fix: string;
}

function has(bin: string): boolean {
  try {
    return Bun.which(bin) != null;
  } catch {
    return false;
  }
}

export function doctorCmd(json: boolean): number {
  const checks: Check[] = [];

  // agent-browser — required only for Cine Colombia (browser-assisted login + checkout).
  const ab = has("agent-browser");
  checks.push({
    check: "agent-browser",
    status: ab ? "ok" : "missing",
    detail: ab ? "instalado" : "requerido para Cine Colombia (login/compra por navegador)",
    fix: ab ? "" : "npm i -g agent-browser  (o: brew install agent-browser) && agent-browser install",
  });

  // A Chrome/Chromium for agent-browser to drive.
  const chrome = has("google-chrome") || has("chromium") || has("chromium-browser") ||
    process.platform === "darwin"; // macOS bundles it via agent-browser install
  checks.push({
    check: "chrome",
    status: chrome ? "ok" : "missing",
    detail: chrome ? "disponible" : "agent-browser necesita un Chrome",
    fix: chrome ? "" : "agent-browser install",
  });

  // Per-chain sessions.
  const rf = rfLoad();
  checks.push({
    check: "sesión royalfilms",
    status: !rf ? "missing" : rfExpired(rf) ? "stale" : "ok",
    detail: !rf ? "sin login" : rfExpired(rf) ? "expirada" : `${rf.user.correo ?? rf.user.id}`,
    fix: !rf || rfExpired(rf) ? "cinesco royalfilms login" : "",
  });
  const cc = ccLoad();
  checks.push({
    check: "sesión cinecolombia",
    status: !cc || !cc.memberCookie ? "missing" : cc.expired ? "stale" : "ok",
    detail: !cc || !cc.memberCookie ? "sin login" : cc.expired ? "expirada" : "socio activo",
    fix: !cc || !cc.memberCookie || cc.expired ? "cinesco cinecolombia login  (abre el navegador)" : "",
  });

  // Cinemark logs in fresh each purchase (no stored session) — nothing to check.
  checks.push({ check: "cinemark", status: "ok", detail: "login headless por compra (sin sesión guardada)", fix: "" });

  const missing = checks.filter((c) => c.status !== "ok");
  if (json) {
    emitJson({ ok: missing.length === 0, command: "doctor", count: checks.length, data: checks, nextSteps: missing.map((c) => c.fix).filter(Boolean) });
    return 0;
  }
  heading("cinesco doctor");
  const paint = (s: Check["status"]) => (s === "ok" ? style.green("ok") : s === "stale" ? style.yellow("stale") : style.red("falta"));
  table(
    checks.map((c) => ({ check: c.check, estado: paint(c.status), detalle: c.detail, arreglo: c.fix || "—" })),
    [
      { key: "check", label: "Chequeo", color: style.cyan },
      { key: "estado", label: "Estado" },
      { key: "detalle", label: "Detalle", max: 40 },
      { key: "arreglo", label: "Arreglo", max: 44 },
    ],
  );
  if (missing.length === 0) note(style.green("\n✓ todo listo — podés comprar en las 3 cadenas."));
  else note(style.dim(`\n${missing.length} pendiente(s). Corré los 'arreglo' de arriba.`));
  return 0;
}
