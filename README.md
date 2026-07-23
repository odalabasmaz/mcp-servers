# mcp-servers

A small collection of **Model Context Protocol (MCP)** servers in TypeScript.
Each server is self-contained under `src/<name>/` with its own README, and they
share one build.

[![pages-build-deployment](https://github.com/odalabasmaz/mcp-servers/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/odalabasmaz/mcp-servers/actions/workflows/pages/pages-build-deployment)

📖 **[Docs / Dokümantasyon](https://odalabasmaz.github.io/mcp-servers/)** — bilingual (TR/EN) visual walkthrough of every server.

## Servers

| Server | Path | What it does |
|--------|------|--------------|
| **infra** | [`src/infra/`](src/infra/README.md) ([design](src/infra/design.md)) | IT-infra ops: `echo`, `check_port`, a system-info resource, a `diagnose_service` prompt. The read-only starter. |
| **calendar** | [`src/calendar/`](src/calendar/README.md) ([design](src/calendar/design.md)) | Interview scheduling: list/find-free/check-conflicts + **mutating** book/cancel tools. Conflict-gated and idempotent. In-memory by default; optional Google Calendar backend. |
| **books** | [`src/books/`](src/books/README.md) ([design](src/books/design.md)) | Online book search via OpenLibrary's `search.json` API, with `limit`/`page` pagination. |
| **weather** | [`src/weather/`](src/weather/README.md) ([design](src/weather/design.md)) | Weather via Open-Meteo: geocode a place name, then get current + daily forecast. Keyless. |
| **whatsapp** | [`src/whatsapp/`](src/whatsapp/README.md) ([design](src/whatsapp/design.md)) | Read/reply to your personal WhatsApp via an unofficial library. ⚠️ Against WhatsApp's ToS — real ban risk, read the README first. |
| **oncall** | [`src/oncall/`](src/oncall/README.md) ([design](src/oncall/design.md)) | Incident triage: open/ack/resolve with state-transition gating, idempotency, and `force` overrides. In-memory. |

## Designing a new server

Before building a new server, fill in a design template and hand it to the
`mcp-builder` skill as the resolved spec:

- [`templates/mcp-server-design-template.md`](templates/mcp-server-design-template.md)
  — full pass: goal/scope, backend/auth, domain model, tool surface, tool vs.
  resource vs. prompt, validation, idempotency, resilience, verification plan.
- [`templates/mcp-server-design-template-light.md`](templates/mcp-server-design-template-light.md)
  — quick version for small/time-boxed builds (e.g. interview exercises):
  requirements, tools, resources, prompts only. Each server's filled copy
  lives next to its code as `src/<name>/design.md` (linked from the table
  above).

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
npm run start:oncall         npm run inspect:oncall
```

See each server's README for tools, registration, and examples.

Run the automated test suite (every server has one, mocking external
HTTP/network/browser dependencies so it runs offline) with:

```bash
npm test
```

## Docs page

**[odalabasmaz.github.io/mcp-servers](https://odalabasmaz.github.io/mcp-servers/)**
— a single-page, bilingual (TR/EN) visual walkthrough of every server:
architecture diagrams, tool/resource/prompt tables, and the real bugs found
while building each one. Source: [`docs/index.html`](docs/index.html),
served via GitHub Pages.

## Adding a new server

1. `mkdir src/<name>` and add `server.ts` (copy an existing one as a template).
2. Add `start:<name>` / `dev:<name>` / `inspect:<name>` scripts and a `bin`
   entry in `package.json`.
3. Add a `README.md` next to `server.ts`, and a row to the table above.

## Layout

```
src/
├── infra/         server.ts + server.test.ts + README.md + design.md
├── calendar/      server.ts + server.test.ts + README.md + design.md (+ backend.ts, google-backend.ts, scripts/)
├── books/         server.ts + server.test.ts + README.md + design.md
├── weather/       server.ts + server.test.ts + README.md + design.md
├── whatsapp/      server.ts + server.test.ts + README.md + design.md (+ scripts/pair.ts)
└── oncall/        server.ts + backend.ts + server.test.ts + README.md + design.md
tsconfig.json   # shared: ES2022 + Node16 modules, compiles src/**/* → dist/ (test files excluded)
package.json    # shared deps + per-server scripts + `test` (vitest)
```
