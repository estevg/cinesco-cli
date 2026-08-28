---
name: cinesco
description: CLI to buy movie tickets in Colombia from the terminal, across 3 chains (Royal Films, Cine Colombia, Cinemark). Browse cities/cinemas/billboard/showtimes, paint the seat map, and take the purchase up to the payment link (never charges). Use it when the user mentions cinema, movie tickets, showtimes, billboard, Royal Films, Cine Colombia or Cinemark in Colombia. Cine Colombia requires agent-browser.
---

# cinesco

One terminal over three Colombian cinema chains. Agent-first: `--json` automatically when
stdout is not a terminal, `schema` and `doctor` for introspection, exit codes 0/1/2.

Install the skill: `npx skills add estevg/cinesco-cli`. Run the CLI: `npx github:estevg/cinesco-cli` (no npm needed) or `bun add -g github:estevg/cinesco-cli`.

## Installing the binary

Download the binary for your platform from Releases (macOS arm64/x64, Linux x64/arm64,
Windows x64), make it executable and optionally move it onto your PATH:

```bash
chmod +x cinesco-macos-arm64 && mv cinesco-macos-arm64 /usr/local/bin/cinesco
cinesco doctor        # what's present and how to fix each gap
```

### Dependency: agent-browser (Cine Colombia only)

Cine Colombia is protected by Cloudflare + reCAPTCHA, so its **login and checkout run
through a real browser** via [agent-browser](https://github.com/vercel-labs/agent-browser).
Royal Films and Cinemark are 100% headless (no browser needed).

```bash
npm i -g agent-browser        # all platforms
brew install agent-browser    # macOS
agent-browser install         # downloads Chrome, first time only
```

Run `cinesco doctor` to see whether it is present and the command that installs it.

## Introspection (run this first)

```bash
cinesco doctor      # installed/logged-in per chain + the command that fixes each gap
cinesco providers   # the three chains and their capabilities
cinesco schema      # command contract, as data
cinesco skills      # this manual, served by the binary
```

## Browse (headless, no login)

```bash
cinesco <chain> regions                      # cities
cinesco <chain> cinemas [region]             # cinemas
cinesco <chain> movies <region>              # billboard
cinesco <chain> showtimes <movieId> <region> # showtimes
# chain = royalfilms | cinecolombia | cinemark
```

Output is JSON when stdout is not a TTY (an agent gets parseable data without passing
`--json`). On a terminal you get tables.

## Conversational booking (the agent flow)

When the user leads with a **movie** (not a chain), start with cross-chain search — it
finds the film across all three chains at once and returns each chain's movie id + region:

```bash
cinesco search "spider-man" --city bogota --json
# → per chain: { chain, region, regionId, matches:[{id,title}] } + nextSteps (showtimes cmds)
```

When the user says something like *"quiero ver una peli en Barranquilla"*, DON'T run the
interactive `start` wizard (it needs a live terminal). Instead fill five slots by calling
the JSON commands and asking the user only for what's missing:

| Slot | How to resolve it | Command |
|---|---|---|
| **city** | fuzzy-match the user's city to a region id | `cinesco <chain> regions --json` |
| **movie** | list the billboard, offer titles | `cinesco <chain> movies <city> --json` |
| **cinema** | group showtimes by cinema | `cinesco <chain> showtimes <movieId> <city> --json` |
| **day** | filter showtimes by date (map "hoy/mañana/viernes") | (same output) |
| **time** | filter by time ("7pm" → 19:00), offer the nearest | (same output) |

Ask only for the empty slots, confirm, then show the concrete options. Example:

```
User:  quiero ver una peli en Barranquilla
Agent: (cinesco cinemark movies barranquilla --json)
       "En Barranquilla hay Spider-Man, Coyote vs Acme, La Odisea… ¿cuál? ¿y en qué cine/día/hora?"
User:  Spider-Man, en Viva Barranquilla, el viernes tipo 7pm
Agent: (cinesco cinemark showtimes 109320 barranquilla --json  → filter cinema=Viva, ~19:00)
       "Tengo 18:15, 19:00 y 21:45 en Viva. ¿Cuál?"
User:  la de las 7
Agent: (cinesco cinemark seats --cinema <id> --session <id> --json → offer free seats)
       "¿Qué butaca? Hay F6, F7, G5…"
User:  F6
Agent: (cinesco cinemark order --cinema <id> --session <id> --movie 109320 --region barranquilla --seats F6 --bank 1007 --json)
       "Listo — orden creada. Pagá acá (no cobré nada): <paymentUrl>"
```

## Agent-ready purchase commands (`--json`)

Credentials come from env vars (never typed in chat): `<CHAIN>_EMAIL`, `<CHAIN>_PASSWORD`
(e.g. `CINEMARK_EMAIL`, `CINEMARK_PASSWORD`, `ROYALFILMS_EMAIL`, `ROYALFILMS_PASSWORD`).

```bash
cinesco <chain> seats  --cinema <id> --session <id> --json      # free seats (labels, price, special)
cinesco <chain> fares  --cinema <id> --session <id> --json      # ticket types + price
cinesco <chain> order  --cinema <id> --session <id> --seats F6,F7 \
        --movie <id> --region <city> [--bank 1007] --json       # reserve + payment link
# order → { orderId, total, seats, paymentUrl, method }.  Never charges — stops at the link.
```

- Royal Films / Cinemark: fully non-interactive with the env vars above.
- Cine Colombia is browser-assisted (Cloudflare) — its `order` needs the interactive
  browser session; guide the user to `cinesco start` for that chain.
- PSE banks (Cinemark `--bank`): 1007 BANCOLOMBIA, 1051 DAVIVIENDA, 1013 BBVA, 1507 NEQUI, 1551 DAVIPLATA, …

## Buy (full wizard)

```bash
cinesco start   # pick a chain → login → city → movie → cinema → showtime →
                # seat map → seats → (PSE bank if any) → payment link
```

- **The CLI never charges.** It generates an external payment link/HTML (PSE, ePayco,
  PlacetoPay) and the human pays at their bank/gateway.
- Reserving creates a real order that holds the seats (Royal Films and Cinemark allow one
  pending order per member; if you don't pay, it expires on its own).

## Auth per chain

| Chain | Login | Browser | Payment |
|---|---|---|---|
| Royal Films | email + password → JWT | no | ePayco |
| Cinemark | email + password → 24h token | no | PSE / PayU |
| Cine Colombia | browser (Cloudflare + reCAPTCHA) | **yes (agent-browser)** | PlacetoPay |

Sessions/tokens live in `~/.cinesco` and `~/.royalfilms` (mode 600). The password is never stored.

## Privacy

Each user logs in with their own credentials; the CLI sends their own data (name, email,
phone, national id) **only to their cinema's official API**, over HTTPS, for their own
purchase. Nothing goes to third parties except `api.ipify.org` (returns your public IP,
required by Cinemark's PSE payment). Nothing is transmitted to whoever publishes the CLI.

## JSON envelope

Every command under `--json` returns `{ ok, command, count?, data, nextSteps?, error? }`.
Errors carry a stable `error.code`. `doctor --json` carries `nextSteps` with the fix
commands — an agent runs them to get everything ready.
