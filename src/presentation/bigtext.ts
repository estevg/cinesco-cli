// Render short UPPERCASE text as a 5-row block banner (used to announce the chosen
// chain). Only the glyphs the chain names need are encoded; unknown chars are skipped.
const F: Record<string, string[]> = {
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
  " ": ["  ", "  ", "  ", "  ", "  "],
};

// Return the banner as 5 joined lines (empty string if nothing renderable).
export function bigText(text: string): string {
  const chars = [...text.toUpperCase()].map((c) => F[c]).filter(Boolean);
  if (!chars.length) return "";
  const rows: string[] = [];
  for (let r = 0; r < 5; r++) {
    rows.push(chars.map((g) => g[r].padEnd(Math.max(...g.map((x) => x.length)), " ")).join("  "));
  }
  return rows.join("\n");
}
