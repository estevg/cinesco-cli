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

export function skillsCmd(json: boolean): number {
  if (json) emitJson({ ok: true, command: "skills", data: { manual: MANUAL } });
  else process.stdout.write(MANUAL + "\n");
  return 0;
}
