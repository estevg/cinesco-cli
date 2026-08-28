# cinesco

Buy movie tickets in Colombia from the terminal, across 3 chains — **Royal Films**,
**Cine Colombia** and **Cinemark**. Built for an agent to operate and a human to supervise.

Browse cities, cinemas, billboard, showtimes and the seat map; and take the purchase up
to the **payment link**. The CLI **never charges**: it generates the link (PSE, ePayco or
PlacetoPay) and you pay at your bank.

## Install

Runs on Node (built with Bun). No npm account needed — install straight from GitHub:

```bash
npx github:estevg/cinesco-cli doctor          # run without installing
bun add -g github:estevg/cinesco-cli          # or install globally with Bun
```

`cinesco doctor` tells you what's present, what's missing, and the command that fixes it.

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
cinesco doctor                         # what can I use right now
cinesco providers                      # the three chains

# browse (headless, no login)
cinesco cinemark movies bogota
cinesco cinemark showtimes 109320 bogota

# buy (full wizard, up to the payment link)
cinesco start
```

Output is JSON when stdout is not a terminal, so an agent gets parseable data without
passing `--json`. On a terminal you get tables and colour.

## Chains

| Chain | Browse | Login | Browser | Payment |
|---|---|---|---|---|
| **Royal Films** | ✅ | email+password → JWT | no | ePayco |
| **Cinemark** | ✅ | email+password → 24h token | no | PSE / PayU |
| **Cine Colombia** | ✅ | browser (Cloudflare + reCAPTCHA) | **agent-browser** | PlacetoPay |

## Commands

```bash
cinesco doctor | providers | schema | skills | start
cinesco <chain> regions | cinemas [region] | movies <region> | showtimes <movieId> <region>
# chain = royalfilms | cinecolombia | cinemark
```

Run `cinesco skills` for the agent manual served by the binary itself.

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
