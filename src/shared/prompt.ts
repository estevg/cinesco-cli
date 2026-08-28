// Read a line, and a secret without echoing it. In a non-interactive context
// (no TTY) a secret prompt must not hang: it returns null so the caller can
// fail with a structured error instead of blocking forever.
import { createInterface } from "node:readline";

export async function promptLine(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Numbered menu. Prints options to stderr, reads a number, returns 0-based index.
// Returns null off-TTY (agent-first: no hang). Re-asks on invalid input.
export async function promptSelect(
  title: string,
  options: string[],
): Promise<number | null> {
  if (!process.stdin.isTTY) return null;
  process.stderr.write("\n" + title + "\n");
  options.forEach((o, i) => process.stderr.write(`  ${String(i + 1).padStart(2)}. ${o}\n`));
  for (;;) {
    const ans = await promptLine(`elegí [1-${options.length}]: `);
    if (ans === null) return null;
    const n = Number(ans);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
    process.stderr.write("opción inválida\n");
  }
}

export async function promptSecret(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  process.stderr.write(question);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise((resolve) => {
    let secret = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          cleanup();
          process.stderr.write("\n");
          resolve(secret);
          return;
        } else if (c === "") {
          // Ctrl-C
          cleanup();
          process.stderr.write("\n");
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
