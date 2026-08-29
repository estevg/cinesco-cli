<div align="center">
<pre>
 ▄▄█████▄   ███   ███▄   ███  ▄████████   ▄█████▄    ▄█████▄▄    ▄█████▄  
▄███▀▀▀███  ███   ████▄  ███  ████▀▀▀▀▀  ███  ▀▀▀▀  ███▀▀▀███   ███▀▀▀███▄
███         ███   █████▄ ███  ████████▄  ▀█████▄▄   ███        ███▀    ███
███    ▄▄   ███   ███ ██████  ████▀▀▀▀      ▀▀████  ███    ▄   ███▄    ███
▀███▄▄▄███  ███   ███  █████  ████▄▄▄▄▄  ███▄▄▄███  ███▄▄▄███▀  ███▄▄▄███▀
  ▀█████▀   ███   ███   ▀███  ▀████████   ▀█████▀    ▀█████▀▀    ▀█████▀  
</pre>
</div>

<div align="center"><sub>una terminal, todas las salas de cine</sub></div>

Buy movie tickets in Colombia from the terminal, across 3 chains — **Royal Films**,
**Cine Colombia** and **Cinemark**. Built for an agent to operate and a human to supervise.

Browse cities, cinemas, billboard, showtimes and the seat map; and take the purchase up
to the **payment link**. The CLI **never charges**: it generates the link (PSE, ePayco or
PlacetoPay) and you pay at your bank.

## Install

No npm account needed — install straight from GitHub. **Bun is the simplest** (installs clean, no flags):

```bash
bun add -g github:estevg/cinesco-cli               # recommended
```

With **npm** you must pass `--install-links` (npm 11.x otherwise leaves a broken symlink):

```bash
npm i -g --install-links github:estevg/cinesco-cli
```

Or run it once without installing:

```bash
npx github:estevg/cinesco-cli doctor
```

Re-run the same command to update. `cinesco doctor` tells you what's present, what's missing, and the command that fixes it.

### agent-browser (Cine Colombia only)

Cine Colombia is protected by Cloudflare + reCAPTCHA, so its **login and checkout run
through a real browser**, via [agent-browser](https://github.com/vercel-labs/agent-browser).
Royal Films and Cinemark are 100% headless — no browser needed.

```bash
npm i -g agent-browser        # all platforms
brew install agent-browser    # macOS
agent-browser install         # downloads Chrome, first time only
```

### From source (requires [Bun](https://bun.sh))

```bash
bun install
bun run build          # bundles dist/cinesco.js and dist/royalfilms.js (Node targets)
node dist/cinesco.js doctor
```

Optional native binaries (no Node/Bun needed): `bun run build:binaries` → `binaries/`.

## Quick start

```bash
cinesco --help                         # the full command surface (alias for `schema`)
cinesco doctor                         # what can I use right now
cinesco providers                      # the three chains

# search a movie across all three chains at once (lead with the movie, not the chain)
cinesco search "spider-man" --city bogota

# browse (headless, no login). Start with `regions`: Royal Films and Cinemark
# take the region ID it returns, not a city name.
cinesco cinemark regions               # cities + their IDs (e.g. bogota, soledad)
cinesco cinemark movies bogota
cinesco cinemark showtimes 109320 bogota --date viernes   # natural dates: hoy | mañana | <weekday>

# buy — interactive wizard for a human…
cinesco start
# …or non-interactive for an agent/script (credentials via env vars):
CINEMARK_EMAIL=you@mail.com CINEMARK_PASSWORD=... \
  cinesco cinemark order --cinema 2401 --session 151754 --seats F6 \
    --movie 109320 --region bogota --bank 1007 --json
# → { orderId, total, seats, paymentUrl }.  The CLI never charges — it stops at the link.
```

Output is JSON when stdout is not a terminal, so an agent gets parseable data without
passing `--json`. On a terminal you get tables and colour.

## For agents (conversational booking)

An agent doesn't drive the interactive wizard — it calls the `--json` commands and holds
the conversation itself, filling slots (**city → movie → cinema → day → time → seat**) and
asking only for what's missing. From *"I want to see Spider-Man in Bogotá on Friday"* it
runs `search` → `showtimes --date viernes` → `seats` → `order` and hands back the payment
link. The full recipe + example dialogue lives in the agent skill:

```bash
npx skills add estevg/cinesco-cli     # install the skill
cinesco skills                        # or read the manual straight from the binary
```

## Chains

<div align="center">
<pre>
█████▄  ▄████▄  ██  ██   ▄██   ▄█▄        █████ ██  ██     ███ ▄██  ▄████▄
██▄▄██  ██  ██▄  ████   ▄█▀██  ███        ██▄▄  ██  ██     ███ ███  ██▄▄▄ 
██▀██▄  ██  ██▀   ██    ██▄██▄ ███        ██▀▀  ██  ██     █▀███ █  ▄▄▀▀██
██  ██▄ ▀████▀    ██   ██▀▀▀██ ▀█████     ██    ██  █████  █  █▀ █  ▀████▀
</pre>
</div>
<div align="center"><b>Royal Films</b></div>

<div align="center">
<pre>
▄█▀██  █▄ ██  █  ██▀▀▀    ██▀█▄ ▄█▀██  █▄   ▄█▀██  ██▄ ██  ████▄ ██  ▄██  
██     ██ ███▄█  ██▀▀    ██     █   ██ █▀   ██  ██ ██████  ██▀█▄ ██  █▄██ 
▀█▄██  █▀ ██ ▀█  ██▄▄▄    ██▄█▀ ▀█▄██  ████ ▀█▄██  █ ██ █  ██▄█▀ ██ ██▀▀██
</pre>
</div>
<div align="center"><b>Cine Colombia</b></div>

<div align="center">
<pre>
 ▄█████▄  ███  ██▄  ▄██  ███████  ███▄  ███    ▄███    ███████▄  ███ ▄███ 
███▀ ▀▀▀  ███  ████ ███  ███      ████ ████    ████▄   ███  ███  ███▄██▀  
███       ███  ██▀█████  ███████  ██▀█▄████   ██▀ ██   ███████▀  ██████▄  
███  ▄██  ███  ██  ████  ███      ██ ███ ██  ▄███████  ███ ███   ███ ▀██▄ 
 ▀█████▀  ███  ██   ███  ███████  ██ ▀██ ██  ██▀   ██▄ ███  ███  ███  ▀██▄
</pre>
</div>
<div align="center"><b>Cinemark</b></div>

| Chain | Browse | Login | Browser | Payment |
|---|---|---|---|---|
| **Royal Films** | ✅ | email+password → JWT | no | ePayco |
| **Cinemark** | ✅ | email+password → 24h token | no | PSE / PayU |
| **Cine Colombia** | ✅ | browser (Cloudflare + reCAPTCHA) | **agent-browser** | PlacetoPay |

## Commands

```bash
cinesco --help | schema                                         # documented surface (--help, -h, help all alias to schema)
cinesco <chain> --help                                          # per-chain help, scoped to that chain (also `cinesco <chain>`)
cinesco doctor | providers | skills | start
cinesco search "<movie>" --city <city>                          # cross-chain movie search

cinesco <chain> regions                                         # cities + their IDs — start here (Royal Films/Cinemark need the ID)
cinesco <chain> cinemas [region] | movies <region>
cinesco <chain> showtimes <movieId> <region> [--date hoy|mañana|<weekday>|YYYY-MM-DD]
# every row of `showtimes` carries the cinema/hall/session/movie ids the purchase commands need

# sessions
cinesco <chain> login | status                                  # save/inspect a session (Royal Films, Cine Colombia)

# agent-ready purchase (--json; log in once with `cinesco <chain> login`, or set <CHAIN>_EMAIL / <CHAIN>_PASSWORD):
cinesco <chain> seats  --cinema <id> --session <id> [--hall <id>]           # free seats + per-seat price (--hall: Royal Films)
cinesco <chain> fares  --cinema <id> --session <id> [--hall <id>]           # ticket types + price
cinesco <chain> order  --cinema <id> --session <id> --seats F6 --movie <id> --region <city> [--hall <id>] [--bank 1007]
cinesco <chain> order  ... --dry-run                                        # price the seats without reserving (no hold, no link)

# manage
cinesco royalfilms pending                                      # in-process sales (Royal Films)
cinesco royalfilms cancel <reservaId>                           # release a stuck seat hold
cinesco cinecolombia cancel <orderId>                           # cancel an order (Cine Colombia)
# chain = royalfilms | cinecolombia | cinemark
```

`cinesco doctor` lists what's installed/logged-in and the command that fixes each gap.
Run `cinesco skills` for the agent manual served by the binary itself. Each chain's
`--help` prints its own banner and only the commands that chain supports.

## Privacy & security

- The CLI **never charges**: it stops at the payment link; you pay at your bank/gateway.
- Each user logs in with **their** credentials and the CLI sends **their** data (name,
  email, phone, national id) **only to their cinema's official API**, over HTTPS, for
  their purchase.
- Tokens/sessions live in `~/.cinesco` and `~/.royalfilms` (mode 600). **The password is
  never stored** — only the resulting token.
- The sole third-party call is `api.ipify.org` (returns your public IP, required by
  Cinemark's PSE payment). Nothing is transmitted to whoever publishes the CLI.

## Architecture

Clean Architecture: `domain` (entities + ports) → `application` (use cases: BrowseCatalog,
PurchaseTickets) → `infrastructure` (one adapter per chain + a shared HTTP client) →
`presentation` (CLI + wizard). Adding a chain is writing an adapter that implements
`CatalogPort` (and `PurchasePort` if it sells) and registering it.

## License

MIT.
