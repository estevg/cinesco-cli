// `cinesco skills` — the agent manual, served by the binary itself (so an agent learns
// the surface without a network fetch). Mirrors skills/cinesco/SKILL.md.
import { emitJson } from "../shared/output.ts";

export const MANUAL = `# cinesco — agent manual

One terminal over 3 Colombian cinema chains: Royal Films, Cine Colombia, Cinemark.
Agent-first: JSON output automatically when stdout is not a TTY; exit 0 ok / 1 api / 2 usage.

## Start here
- \`cinesco doctor\`      what's installed/logged in and the command that fixes each gap
- \`cinesco providers\`   the three chains + capabilities
- \`cinesco schema\`      command contract (for agents)

## Browse (headless, no login)
- \`cinesco <chain> regions\`                 cities
- \`cinesco <chain> cinemas [region]\`        cinemas
- \`cinesco <chain> movies <region>\`         billboard
- \`cinesco <chain> showtimes <movieId> <region>\`  showtimes
  chain = royalfilms | cinecolombia | cinemark

## Buy (up to the payment link — the CLI NEVER charges)
- \`cinesco start\`  guided wizard: pick a chain → login → city → movie → cinema →
  showtime → seat map → seats → (bank) → payment link.
- Generates an external payment link/HTML; the human pays at their bank/gateway.

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

export function skillsCmd(json: boolean): number {
  if (json) emitJson({ ok: true, command: "skills", data: { manual: MANUAL } });
  else process.stdout.write(MANUAL + "\n");
  return 0;
}
