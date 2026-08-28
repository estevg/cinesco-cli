---
name: cinesco
description: CLI to buy movie tickets in Colombia from the terminal, across 3 chains (Royal Films, Cine Colombia, Cinemark). Browse cities/cinemas/billboard/showtimes, paint the seat map, and take the purchase up to the payment link (never charges). Use it when the user mentions cinema, movie tickets, showtimes, billboard, Royal Films, Cine Colombia or Cinemark in Colombia. Cine Colombia requires agent-browser.
---

# cinesco

One terminal over three Colombian cinema chains. Agent-first: `--json` automatically when
stdout is not a terminal, `schema` and `doctor` for introspection, exit codes 0/1/2.

Install the skill: `npx skills add <owner>/<repo>`

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
