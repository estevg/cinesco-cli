#!/usr/bin/env bun
import { COMMANDS, findCommand, UsageError } from "./commands.ts";
import { ApiError } from "../infrastructure/royalfilms/api.ts";
import { emitJson, jsonMode, banner, logo, errline, note, style, heading, table } from "../shared/output.ts";

const VERSION = "0.1.0";

interface Parsed {
  positionals: string[];
  flags: Record<string, string>;
  json: boolean;
}

function parseArgs(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
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

function printHelp(): void {
  note(style.bold("royalfilms") + " — cartelera de Royal Films (API pública) desde la terminal\n");
  note(style.dim("uso: royalfilms <noun> <verb> [args] [--flags] [--json]\n"));
  // group by noun
  const byNoun = new Map<string, typeof COMMANDS>();
  for (const c of COMMANDS) {
    if (!byNoun.has(c.noun)) byNoun.set(c.noun, []);
    byNoun.get(c.noun)!.push(c);
  }
  for (const [noun, cmds] of byNoun) {
    process.stderr.write(style.cyan(noun) + "\n");
    for (const c of cmds) {
      const sig = [c.verb, ...c.args.map((a) => `<${a}>`)].join(" ");
      const flagsig = c.flags?.length ? " " + c.flags.map((f) => `[--${f.name}]`).join(" ") : "";
      process.stderr.write("  " + style.bold(sig + flagsig).padEnd(46) + style.dim(c.summary) + "\n");
    }
  }
  process.stderr.write(
    "\n" +
      style.cyan("otros") +
      "\n  " +
      style.bold("logo").padEnd(28) +
      style.dim("mostrar el logotipo\n  ") +
      style.bold("schema").padEnd(28) +
      style.dim("contrato de comandos como JSON\n  ") +
      style.bold("--version").padEnd(28) +
      style.dim("versión\n  ") +
      style.bold("--help").padEnd(28) +
      style.dim("esta ayuda\n"),
  );
}

// Machine-introspectable contract. Agents read this instead of parsing --help.
function schema(json: boolean): void {
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
      nextSteps: "string[]?",
    },
    exitCodes: { "0": "success", "1": "api or network failure", "2": "usage error" },
    commands: COMMANDS.map((c) => ({
      command: `${c.noun} ${c.verb}`,
      args: c.args,
      flags: (c.flags ?? []).map((f) => ({ name: f.name, description: f.desc })),
      summary: c.summary,
    })),
  };
  if (json) {
    emitJson({ ok: true, command: "schema", data: spec });
  } else {
    heading(`royalfilms schema v${spec.schemaVersion} (cli ${VERSION})`);
    table(
      spec.commands.map((c) => ({ command: c.command, args: c.args.join(" "), summary: c.summary })),
      [
        { key: "command", label: "Comando", color: style.cyan },
        { key: "args", label: "Args" },
        { key: "summary", label: "Descripción", max: 44 },
      ],
    );
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const { positionals, flags, json: jsonFlag } = parseArgs(argv);
  const json = jsonMode(jsonFlag);

  if (flags.version || positionals[0] === "version") {
    if (json) emitJson({ ok: true, command: "version", data: { version: VERSION } });
    else process.stdout.write(VERSION + "\n");
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
          error: { code: "no-command", message: "falta un comando — corré 'schema --json' para ver el contrato" },
        });
      } else {
        emitJson({ ok: true, command: "help", data: { hint: "run: schema --json" } });
      }
    } else {
      logo();
      printHelp();
    }
    return bareInvoke ? 2 : 0;
  }

  if (positionals[0] === "logo") {
    if (json) emitJson({ ok: true, command: "logo", data: { name: "ROYAL FILMS", subtitle: "cine en tu terminal" } });
    else logo(true);
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
    const msg = `comando desconocido: "${attempted}" — probá 'royalfilms schema'`;
    if (json) emitJson({ ok: false, command: `${noun} ${verb ?? ""}`.trim(), error: { code: "unknown-command", message: msg } });
    else errline(msg);
    return 2;
  }

  const commandName = `${cmd.noun} ${cmd.verb}`;
  if (rest.length < cmd.args.length) {
    const msg = `faltan argumentos: se esperaban ${cmd.args.map((a) => `<${a}>`).join(" ")}`;
    if (json) emitJson({ ok: false, command: commandName, error: { code: "missing-args", message: msg } });
    else errline(`${commandName}: ${msg}`);
    return 2;
  }

  if (!json) banner();

  try {
    const result = await cmd.run(rest, flags);
    if (json) {
      emitJson({
        ok: true,
        command: commandName,
        count: result.count,
        data: result.data,
        nextSteps: result.nextSteps,
      });
    } else {
      result.human();
      if (result.nextSteps?.length) {
        note("\nsiguiente: " + result.nextSteps.map((s) => style.dim(s)).join("  ·  "));
      }
    }
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      if (json) emitJson({ ok: false, command: commandName, error: { code: "usage", message: e.message } });
      else errline(`${commandName}: ${e.message}`);
      return 2;
    }
    if (e instanceof ApiError) {
      if (json) emitJson({ ok: false, command: commandName, error: { code: e.code, message: e.message } });
      else errline(`${commandName}: ${e.message}`);
      return 1;
    }
    const msg = (e as Error).message ?? String(e);
    if (json) emitJson({ ok: false, command: commandName, error: { code: "internal", message: msg } });
    else errline(`${commandName}: ${msg}`);
    return 1;
  }
}

// Set exitCode instead of process.exit(): calling exit() can truncate a large
// stdout write that has not drained yet (JSON payloads exceed the 64KB pipe buffer).
// Letting the event loop empty naturally flushes stdout first.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    process.stderr.write(`fatal: ${(e as Error).message}\n`);
    process.exitCode = 1;
  });
