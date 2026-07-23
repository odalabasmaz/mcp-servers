# oncall-mcp-server

An MCP server that tracks incidents through their lifecycle — themed around
on-call triage: open an incident, acknowledge it, resolve it, and query
what's active.

---

## What is it

A Model Context Protocol server whose tools model an incident state machine
(`open → acked → resolved`). Like `calendar`, it demonstrates the things a
real mutating integration has to get right:

- **State-transition gating** — `ack_incident`/`resolve_incident` refuse
  invalid transitions (e.g. resolving an incident that's still open) unless
  explicitly `force`d.
- **Idempotency** — `open_incident` accepts an `idempotencyKey` so a retried
  call returns the existing incident instead of creating a duplicate;
  `ack_incident`/`resolve_incident` are naturally idempotent (re-acking with
  the same assignee, or re-resolving, is a no-op, not an error).
- **Structured errors** — invalid input or an invalid transition comes back
  as a typed `isError: true` result, not a thrown exception.

State lives in an in-memory backend (`backend.ts`) — no real
PagerDuty/Opsgenie integration; this is a scoped exercise, not a production
integration (see [`design.md`](design.md) for the full requirements pass).

### What it exposes

| Name | Kind | Purpose |
|------|------|---------|
| `open_incident` | tool (write) | Create an incident in `open` status; conflict-free (each incident is independent), idempotent via `idempotencyKey` |
| `ack_incident` | tool (write) | Acknowledge an open incident, assign an owner; idempotent re-ack, `force` to reassign |
| `resolve_incident` | tool (write) | Resolve an acked incident; idempotent re-resolve, `force` to resolve directly from `open` |
| `list_incidents` | tool (read) | List incidents, filterable by `status`/`severity`/`assignee` |
| `get_incident` | tool (read) | Full detail for one incident by id |
| `triage_flow` | prompt | Chains the tools: list open → get detail → ack → (fix it) → resolve |

> **Concurrency note:** the in-memory backend does everything synchronously
> in a single process, so state-transition checks are atomic by construction.
> A real backend (PagerDuty/Opsgenie API) would only offer check-then-write,
> the same caveat documented for `calendar`'s Google backend.

---

## How to use

Run from the **repo root** (build and test are shared across all servers):

```bash
npm install
npm run build
npm test          # runs src/oncall/server.test.ts (vitest) among others
```

### Interactive UI (MCP Inspector)

```bash
npm run inspect:oncall
```

### Register with an MCP client (e.g. Claude Code)

```bash
claude mcp add oncall --scope user -- \
  node /Users/odalabasmaz/workspace/mcp-servers/dist/oncall/server.js
```

### Quick sanity check (raw JSON-RPC)

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"c","version":"0"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"open_incident","arguments":{"title":"payments down","description":"5xx from payments-api","affectedServices":["payments-api"],"severity":"critical","ownerTeam":"payments"}}}' \
| node dist/oncall/server.js
```

Expect a result with `"status": "open"` and `"id": "INC-1"`.

> Send **one tool call per invocation** for a manual sanity check like this
> one. Piping several mutating calls in a single batch (e.g. `open_incident`
> immediately followed by `ack_incident` in the same `printf`) races the
> requests — nothing guarantees the server finishes creating the incident
> before it processes the next line, so `ack_incident` can run against an
> incident that doesn't exist yet. Real MCP clients always await one
> response before sending the next call, so this doesn't happen in practice.
> The full ordered lifecycle (open → ack → resolve, including the
> conflict/idempotency/force paths) is covered by the automated test suite
> instead — see `server.test.ts`, which drives the server over a proper
> request/response transport.

## Design notes

- **No cross-incident conflict check** — unlike `calendar` (where two events
  can genuinely overlap), incidents don't collide with each other; the only
  duplicate to guard against is a *retried create*, so `open_incident` only
  needs `idempotencyKey` dedup, not a conflict gate.
- **`force` means two different things depending on the tool** —
  reassignment (`ack_incident`) vs. skipping a state (`resolve_incident`
  directly from `open`). Each is documented in its own tool description
  rather than implying one shared "override" semantic.
- **Tool annotations** (`readOnlyHint`/`destructiveHint`/`idempotentHint`/
  `openWorldHint`) are set explicitly on every tool so a client can decide
  whether to gate a call behind human confirmation without parsing the
  description text.
- **No `incident://{id}` resource** — deliberately left out for this pass;
  `get_incident` covers the same lookup. See `design.md` for the tradeoff.

## Layout

```
src/oncall/server.ts        # tools, prompt, backend wiring
src/oncall/backend.ts       # OnCallBackend interface + InMemoryOnCallBackend
src/oncall/server.test.ts   # vitest suite: happy paths + conflict/idempotency/force edge cases
src/oncall/design.md        # filled design template (light) for this server
src/oncall/README.md        # this file
```
