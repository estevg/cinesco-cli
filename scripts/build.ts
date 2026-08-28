// Build both CLIs into Node-runnable bundles (dist/*.js) with a node shebang.
// Dev/build/test use Bun; the shipped bundle runs on plain Node (like butaca).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

const bins: [string, string][] = [
  ["src/presentation/cinesco.ts", "dist/cinesco.js"],
  ["src/presentation/cli.ts", "dist/royalfilms.js"],
];

for (const [entry, out] of bins) {
  const r = spawnSync("bun", ["build", entry, "--target", "node", "--outfile", out], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  let src = readFileSync(out, "utf8");
  src = src.replace(/^#![^\n]*\n/, ""); // drop any inherited shebang
  writeFileSync(out, "#!/usr/bin/env node\n" + src);
  chmodSync(out, 0o755);
  console.log("built", out);
}
