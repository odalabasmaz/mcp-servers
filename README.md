# mcp-servers

A small collection of **Model Context Protocol (MCP)** servers in TypeScript.
Each server is self-contained under `src/<name>/` with its own README, and they
share one build.

## Servers

| Server | Path | What it does |
|--------|------|--------------|
| **infra** | [`src/infra/`](src/infra/README.md) | IT-infra ops: `echo`, `check_port`, a system-info resource, a `diagnose_service` prompt. The read-only starter. |
| **calendar** | [`src/calendar/`](src/calendar/README.md) | Interview scheduling: list/find-free/check-conflicts + **mutating** book/cancel tools. Conflict-gated and idempotent. |

## Getting started

```bash
npm install
npm run build        # compiles every server into dist/<name>/
```

Then run or inspect a specific server:

```bash
npm run start:infra        npm run inspect:infra
npm run start:calendar     npm run inspect:calendar
```

See each server's README for tools, registration, and examples.

## Adding a new server

1. `mkdir src/<name>` and add `server.ts` (copy an existing one as a template).
2. Add `start:<name>` / `dev:<name>` / `inspect:<name>` scripts and a `bin`
   entry in `package.json`.
3. Add a `README.md` next to `server.ts`, and a row to the table above.

## Layout

```
src/
├── infra/      server.ts + README.md
└── calendar/   server.ts + README.md
tsconfig.json   # shared: ES2022 + Node16 modules, compiles src/**/* → dist/
package.json    # shared deps + per-server scripts
```
