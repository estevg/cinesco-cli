---
name: royalfilms
description: Query the Royal Films (Colombia) public cinema API from the terminal — cities, cinemas, billboard, showtimes, formats, payment methods. Use when you need Colombian cinema listings or showtimes for a city or movie. Read-only, no auth.
---

# royalfilms

Agent-first CLI over the Royal Films public JSON API (`https://cinemasroyalfilms.com/api`).
Read-only. No credentials. `--json` is automatic when stdout is not a TTY.

## Envelope

Every command prints:

```json
{ "ok": true, "command": "cities list", "count": 32, "data": [ ... ], "nextSteps": ["..."] }
```

On failure: `{ "ok": false, "command": "...", "error": { "code": "...", "message": "..." } }`

Exit codes: `0` success · `1` API/network failure · `2` usage error (unknown command, missing/bad args).

## Introspect first

```bash
royalfilms schema --json     # machine contract: every command, args, flags, exit codes
```

## Workflow: find showtimes for a movie in a city

```bash
royalfilms cities list --json | jq '.data[] | select(.ciudad_nombre=="Bogotá") | .ciudad_id'   # -> 1026
royalfilms billboard by-city 1026 --json | jq '.data[].pelicula | {id:.pelicula_id, t:.pelicula_nombre_formato}'
royalfilms showtimes by-city <movieId> 1026 --json | jq '.data[] | {funcion_id, funcion_fecha, sala:.funcion_sala_id}'
```

`nextSteps` in each response names what to run next.

## Authenticated commands (Phase A)

Login is a direct API call (`POST /auth/login {email,password}` → JWT). The token
is stored under `~/.royalfilms/session.json` (mode 600) and replayed as
`Authorization: Bearer <jwt>` until it expires (~40h). No browser needed.

```bash
royalfilms auth login                 # prompts email + password (password not echoed)
royalfilms auth login --email you@x.com --password ****   # or flags / env
#   env: ROYALFILMS_EMAIL, ROYALFILMS_PASSWORD
royalfilms auth status
royalfilms auth logout
```

Non-interactive with no flags/env fails with `error.code: "no-credentials"` — it never hangs.

```bash
# Paint the hall for a function (needs a session). Get funcionId + salaId from showtimes.
royalfilms showtimes by-city <movieId> <cityId> --json | jq '.data[0]|{funcion_id,funcion_sala_id}'
royalfilms seats map <funcionId> <salaId>            # colored seat grid + prices
royalfilms seats map <funcionId> <salaId> --json     # {summary, sala_info, mapa_sala}
```

Seat map JSON: `data.summary` has `{filas,columnas,total,disponibles,ocupadas,maxPorCompra,precioMin,precioMax,tiers}` (tiers = price by seat type);
`data.mapa_sala[]` carries each `{silla_id, mapa_sala_numero_silla, silla_disponible, mapa_sala_estado_silla, silla_precio}`.

## Reserve & checkout (Phase B)

Holding seats is a real, reversible write (holds auto-expire in ~8 min). **`reserve
hold` is dry-run by default** — it validates seats against the live map and prints the
body it would send; add `--confirm` to actually hold. Every real hold/release is
written to an append-only audit log under `~/.royalfilms/audit/` (two-phase).

```bash
royalfilms reserve hold <funcionId> <salaId> <multicineId> --seats F17,F16      # dry-run
royalfilms reserve hold <funcionId> <salaId> <multicineId> --seats F17,F16 --confirm
royalfilms reserve release <reservaId>                                       # undo a hold
royalfilms checkout preview <funcionId> <salaId> <multicineId> --seats F17,F16   # payment summary, never charges
```

**The CLI never charges.** `/sale` + ePayco is a real payment with a reverse-engineered,
unverified payload, and the checkout is an ePayco on-page widget, not a shareable URL.
`checkout preview` shows the total and the sale body the site *would* build, then directs
the user to complete payment in the browser at cinemasroyalfilms.com with their session.

## Commands

| Command | Args | What |
|---|---|---|
| `logo` | | Mostrar el logotipo ASCII |
| `buy start` | | Asistente interactivo de compra (país→…→butacas→reserva) |
| `auth login` | | Iniciar sesión, guardar token local |
| `auth status` | | Estado de la sesión |
| `auth logout` | | Borrar el token local |
| `seats map` | `<funcionId> <salaId>` | Pintar el mapa de butacas (requiere sesión) |
| `reserve hold` | `<funcionId> <salaId> <multicineId>` | Retener butacas (`--seats`, dry-run salvo `--confirm`) |
| `reserve release` | `<reservaId>` | Liberar una reserva |
| `checkout preview` | `<funcionId> <salaId> <multicineId>` | Resumen de pago (no cobra) |
| `checkout session` | `<funcionId> <salaId> <multicineId> <cityId>` | Genera sesión ePayco + HTML del formulario (no cobra) |
| `cities list` | | All cities (ciudad_id, name, país) |
| `countries list` | | Countries served |
| `city get` | `<cityId>` | City detail (may be empty) |
| `cinemas by-city` | `<cityId>` | Cinemas in a city |
| `billboard by-city` | `<cityId>` | Now-showing (add `--cinema <id>` to filter) |
| `billboard coming-soon` | `<cityId>` | Upcoming releases |
| `movie by-city` | `<movieId> <cityId>` | Movie detail in a city |
| `movie by-cinema` | `<movieId> <cinemaId>` | Movie detail at a cinema |
| `showtimes by-city` | `<movieId> <cityId>` | Functions/showtimes |
| `services by-city` | `<cityId>` | Premium formats (VIP, etc.) |
| `banners by-city` | `<cityId>` | Ad banners |
| `popups by-city` | `<cityId>` | Ad popups |
| `promotions list` | | Promotions |
| `payment-methods by-city` | `<cityId>` | Payment methods |
| `identity-types list` | | ID document types + regex |
| `identity-types by-country` | `<countryId>` | ID types by country |
| `products list` | | Products (default channel/cinema) |

## Limits

- **Seat holds are real inventory** (auto-expire ~8 min). `reserve hold` is dry-run unless `--confirm`; always releasable with `reserve release`.
- **Payment is not automated.** The CLI stops at `checkout preview`; the actual ePayco charge is completed by the human in the browser. This is a deliberate safety boundary, not a missing feature.
- Exit codes: `0` ok · `1` API/network/auth failure · `2` usage error.
- Undocumented private API — a site redeploy can move it. Field names are Spanish DB columns (`ciudad_`, `pelicula_`, `funcion_`). See the recon report in the repo.
