# mcp-servers

A small collection of **Model Context Protocol (MCP)** servers in TypeScript.
Each server is self-contained under `src/<name>/` with its own README, and they
share one build.

## Servers

| Server | Path | What it does |
|--------|------|--------------|
| **infra** | [`src/infra/`](src/infra/README.md) | IT-infra ops: `echo`, `check_port`, a system-info resource, a `diagnose_service` prompt. The read-only starter. |
| **calendar** | [`src/calendar/`](src/calendar/README.md) | Interview scheduling: list/find-free/check-conflicts + **mutating** book/cancel tools. Conflict-gated and idempotent. In-memory by default; optional Google Calendar backend. |
| **books** | [`src/books/`](src/books/README.md) | Online book search via OpenLibrary's `search.json` API, with `limit`/`page` pagination. |
| **weather** | [`src/weather/`](src/weather/README.md) | Weather via Open-Meteo: geocode a place name, then get current + daily forecast. Keyless. |
| **whatsapp** | [`src/whatsapp/`](src/whatsapp/README.md) | Read/reply to your personal WhatsApp via an unofficial library. ⚠️ Against WhatsApp's ToS — real ban risk, read the README first. |

## Getting started

```bash
npm install
npm run build        # compiles every server into dist/<name>/
```

Then run or inspect a specific server:

```bash
npm run start:infra          npm run inspect:infra
npm run start:calendar       npm run inspect:calendar
npm run start:books           npm run inspect:books
npm run start:weather        npm run inspect:weather
npm run start:whatsapp        npm run inspect:whatsapp
```

See each server's README for tools, registration, and examples.

## Docs page

[`docs/index.html`](docs/index.html) — a single-page, bilingual (TR/EN) visual
walkthrough of every server: architecture diagrams, tool/resource/prompt
tables, and the real bugs found while building each one. Open it directly in
a browser, or serve it via GitHub Pages (Settings → Pages → deploy from
`/docs`).

## Adding a new server

1. `mkdir src/<name>` and add `server.ts` (copy an existing one as a template).
2. Add `start:<name>` / `dev:<name>` / `inspect:<name>` scripts and a `bin`
   entry in `package.json`.
3. Add a `README.md` next to `server.ts`, and a row to the table above.

## Layout

```
src/
├── infra/         server.ts + README.md
├── calendar/      server.ts + README.md (+ google-backend.ts, scripts/)
├── books/         server.ts + README.md
├── weather/       server.ts + README.md
└── whatsapp/      server.ts + README.md (+ scripts/pair.ts)
tsconfig.json   # shared: ES2022 + Node16 modules, compiles src/**/* → dist/
package.json    # shared deps + per-server scripts
```
