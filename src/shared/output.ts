// Presentation primitives, reimplemented inline instead of pulling a block registry.
// Rules this file enforces (agent-first):
//  - data on stdout, diagnostics/banner on stderr
//  - JSON is automatic when stdout is not a TTY, even without --json
//  - machine output carries no ANSI escapes
//  - NO_COLOR disables styling without changing content
//  - tables align on visible width, not string length

const stdoutIsTTY = Boolean(process.stdout.isTTY);
const colorEnabled = stdoutIsTTY && !process.env.NO_COLOR;

const ESC = "\x1b[";
function paint(code: string, s: string): string {
  return colorEnabled ? `${ESC}${code}m${s}${ESC}0m` : s;
}
export const style = {
  bold: (s: string) => paint("1", s),
  dim: (s: string) => paint("2", s),
  cyan: (s: string) => paint("36", s),
  green: (s: string) => paint("32", s),
  yellow: (s: string) => paint("33", s),
  red: (s: string) => paint("31", s),
  magenta: (s: string) => paint("35", s),
};

// Visible width: strip ANSI, then count code points (good enough for Latin text).
export function visibleWidth(s: string): number {
  // eslint-disable-next-line no-control-regex
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  return [...stripped].length;
}

export function jsonMode(forced: boolean): boolean {
  return forced || !stdoutIsTTY;
}

// The machine envelope every command returns. This is the published contract.
export interface Envelope {
  ok: boolean;
  command: string;
  count?: number;
  data?: unknown;
  error?: { code: string; message: string };
  nextSteps?: string[];
}

export function emitJson(env: Envelope): void {
  process.stdout.write(JSON.stringify(env, null, stdoutIsTTY ? 2 : 0) + "\n");
}

// Banner goes to STDERR so it never pollutes machine output. TTY-only.
export function banner(): void {
  if (!stdoutIsTTY) return;
  process.stderr.write(
    style.bold(style.magenta("Royal Films")) +
      style.dim(" · cartelera desde la terminal\n"),
  );
}

// ASCII wordmark. STDERR, TTY-only (respects NO_COLOR via style). Shown at the
// human entry points (help, wizard) and via the `logo` command.
const LOGO = [
  "██████╗  ██████╗ ██╗   ██╗ █████╗ ██╗",
  "██╔══██╗██╔═══██╗╚██╗ ██╔╝██╔══██╗██║",
  "██████╔╝██║   ██║ ╚████╔╝ ███████║██║",
  "██╔══██╗██║   ██║  ╚██╔╝  ██╔══██║██║",
  "██║  ██║╚██████╔╝   ██║   ██║  ██║███████╗",
  "╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚══════╝",
];
const STRIP = "▐▌ ".repeat(14).trimEnd();

export function logo(toStdout = false): void {
  const out = toStdout ? process.stdout : process.stderr;
  if (!toStdout && !stdoutIsTTY) return;
  out.write("\n" + style.dim(STRIP) + "\n");
  for (const line of LOGO) out.write(style.bold(style.magenta(line)) + "\n");
  out.write(
    style.cyan("       F I L M S") + style.dim("   ·   cine en tu terminal") + "\n",
  );
  out.write(style.dim(STRIP) + "\n");
}

export function heading(text: string): void {
  process.stdout.write("\n" + style.bold(style.cyan(text)) + "\n");
}

export function note(text: string): void {
  process.stderr.write(style.dim(text) + "\n");
}

export function errline(text: string): void {
  process.stderr.write(style.red("error: ") + text + "\n");
}

// Column table that aligns on visible width. columns = [{key,label,color?}]
export interface Column {
  key: string;
  label: string;
  color?: (s: string) => string;
  max?: number;
}

export function table(rows: Record<string, unknown>[], columns: Column[]): void {
  if (rows.length === 0) {
    process.stdout.write(style.dim("(sin resultados)\n"));
    return;
  }
  const cell = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
  const widths = columns.map((c) => {
    const header = visibleWidth(c.label);
    const body = Math.max(
      0,
      ...rows.map((r) => {
        let s = cell(r[c.key]);
        if (c.max && s.length > c.max) s = s.slice(0, c.max - 1) + "…";
        return visibleWidth(s);
      }),
    );
    return Math.max(header, body);
  });

  const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - visibleWidth(s)));

  // header
  const head = columns.map((c, i) => style.dim(pad(c.label, widths[i]))).join("  ");
  process.stdout.write(head + "\n");
  // rows
  for (const r of rows) {
    const line = columns
      .map((c, i) => {
        let s = cell(r[c.key]);
        if (c.max && s.length > c.max) s = s.slice(0, c.max - 1) + "…";
        const padded = pad(s, widths[i]);
        return c.color ? c.color(padded) : padded;
      })
      .join("  ");
    process.stdout.write(line + "\n");
  }
}
