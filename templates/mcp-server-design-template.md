# MCP Server Design Template

Fill this in before handing the requirements to the `mcp-builder` skill (or
before writing any code). It is domain-agnostic — the questions apply whether
the server wraps an incident tracker, a bookstore API, or a todo list.

**How to use it:** answer each question inline (replace the `_(answer)_`
placeholder). Leave `N/A` where a section genuinely doesn't apply — don't
force an answer. Sections marked **Fundamental** are needed for essentially
every server; **Advanced** sections only apply once the basics below them are
true (e.g. "only if the server calls a real external API").

---

## 0. Identity

- **Domain / server name** (noun, not a verb — `incidents`, not `manage`):
  _(answer)_
- **One-sentence purpose** (what can the model do once this exists that it
  couldn't before?):
  _(answer)_

---

## 1. Goal & Scope — Fundamental

- **What should the model be able to *do* or *answer* with this server?**
  State the underlying need, not just the feature name.
  _(answer)_
- **Read-only, mutating, or both?**
  Mutating = creates/updates/deletes real state and needs conflict-checking +
  idempotency (§6). Read-only skips that entirely.
  _(answer)_
- **What's explicitly out of scope for v1?**
  (Prevents scope creep mid-build.)
  _(answer)_
- **Does the backend actually cover everything asked for?**
  If part of the ask has no data source yet, name that gap now rather than
  faking coverage in a tool's schema.
  _(answer)_

---

## 2. Backend / Data Source — Fundamental

- **What backs this server?** Pick one:
  - [ ] In-memory / mock only (demo, no external dependency)
  - [ ] Free/keyless public API
  - [ ] API requiring an API key (service-to-service)
  - [ ] Stateful system requiring OAuth (acting *as* a user)
  - [ ] Other: _(answer)_
- **If a real API/service is involved:**
  - Base URL / endpoint: _(answer or N/A)_
  - Auth mechanism (API key header, OAuth scopes, none): _(answer or N/A)_
  - Where do credentials come from (env var name), and what happens on
    startup if missing? _(answer or N/A — should fail fast with a clear
    message, never silently fall back)_
  - Rate limits / quotas published by the upstream: _(answer or N/A)_
  - Per-call cost, if metered/paid: _(answer or N/A)_
- **Pluggable backend needed?** (i.e. will this swap from a demo backend to a
  real one later — in-memory ↔ real API)
  _(answer — if yes, plan for a `backend.ts` interface + env-var switch, not
  branching logic inside `server.ts`)_

---

## 3. Domain Model — Fundamental

- **What's the core entity/entities?** List the fields each one needs, and
  which are required vs optional.
  _(answer — e.g. for an incident: id, title, description, severity, status,
  owner/team, affected services, created_at, resolved_at)_
- **What states can an entity be in, and what are the valid transitions?**
  Draw it if it helps: `open → acked → resolved → closed`. Note any
  transitions that must be *rejected* (e.g. resolving something already
  closed).
  _(answer or N/A if entities are stateless)_
- **Relationships between entities?** (e.g. an incident belongs to a team,
  references affected services)
  _(answer or N/A)_

---

## 4. Tool Surface Design — Fundamental

List every action as its own row. One responsibility per tool — don't
collapse a multi-step workflow into one opaque call (e.g. `list` and `create`
are separate tools, not a single `manage` tool with a `mode` field).

| Tool name | Purpose (1 line) | Read-only / Mutating | Key inputs | Key outputs |
|---|---|---|---|---|
| _(e.g. list_incidents)_ | | | | |
| | | | | |
| | | | | |

- **Naming convention**: `verb_noun` (`list_incidents`, `ack_incident`) —
  match whatever convention the rest of the repo already uses.
- **Any tool that's really two responsibilities glued together?** Split it.
  _(answer or N/A)_

---

## 5. Tool vs. Resource vs. Prompt — Fundamental

- **Which of the above should be an MCP *resource* instead of a tool?**
  Rule of thumb: pure data lookup with a stable URI-like address (e.g.
  `incident://{id}`) → resource. Anything with side effects, or that needs
  parameters beyond an ID → tool.
  _(answer or N/A)_
- **Is a chaining `prompt` worth adding?**
  Only if a multi-tool workflow is common enough to be worth documenting as a
  named sequence (e.g. "check conflicts → then book" or "list open →
  ack → resolve"). Not every server needs one.
  _(answer or N/A)_
- **If yes, what steps does the prompt walk through, and what guardrails does
  it state** (e.g. "do NOT force without explicit user approval")?
  _(answer or N/A)_

---

## 6. Mutating-Tool Rules — Fundamental (skip entirely if 100% read-only)

- **Conflict check**: what counts as a conflict for this domain (overlapping
  time range, duplicate id, name collision)? What's the default behavior —
  refuse, or require an explicit `force: boolean` to override?
  _(answer or N/A)_
- **Idempotency**: does the tool accept an optional `idempotencyKey` so a
  retried call returns the existing result instead of duplicating? What
  identifies "this is a retry of my own earlier call" vs. "this is a genuine
  new conflict"?
  _(answer or N/A — remember: when the key is omitted on both the request and
  the stored record, `undefined !== undefined` must NOT be treated as "no
  match" — that silently defeats the conflict check)_
- **Concurrency guarantee**: can the backend do an atomic check-then-write, or
  only check-then-insert (most real HTTP APIs)? State this honestly in the
  README rather than implying a guarantee that isn't there.
  _(answer or N/A)_

---

## 7. Validation & Error Handling — Fundamental

- **What can zod's schema express directly** (types, enums, required/optional,
  string formats)? _(answer)_
- **What cross-field/business rules need handler-level checks** (e.g. `end`
  must be after `start`; can't `ack` an already-`resolved` incident)?
  _(answer)_
- **Error reporting**: structured `isError: true` tool result (recommended —
  lets the model reason about failure and retry/ask for approval) vs. thrown
  exception (avoid — looks like a broken tool, not a domain error).
  _(answer — default to structured)_

---

## 8. Query / Response Shape — Fundamental

- **What filters/queries does a list-style tool need?**
  (status, severity, owner, date range, free text, etc.)
  _(answer)_
- **Pagination**: does the upstream (or the expected result size) need
  `limit`/`page`? If wrapping an upstream API, passthrough its native
  pagination params rather than inventing new semantics.
  _(answer or N/A)_
- **Response trimming**: is the raw entity/upstream payload reshaped down to
  only the fields a caller needs, with opaque codes translated to readable
  text (e.g. status codes → labels)?
  _(answer)_

---

## 9. Resilience & Resource Bounds — Advanced (real external API or accumulating state only)

- **Timeout** on every external call (this repo's precedent: 8s via
  `AbortController`). _(answer or N/A)_
- **Retry policy**: retry `429`/`5xx` with backoff (honor `Retry-After` if
  present); never retry other `4xx`. _(answer or N/A)_
- **Rate-limit handling**: throttle outbound calls to the upstream's
  published limit; on a `429` that survives retries, return a `toolError`
  that says so explicitly. _(answer or N/A)_
- **In-memory state bounds**: cap entries / TTL, or explicitly document in
  the README that state is unbounded and demo-only. _(answer or N/A)_
- **Cost cap**: for metered/paid upstream APIs, is a soft usage cap
  (`<NAME>_MAX_CALLS_PER_DAY` or similar) worth adding, failing closed with a
  clear message once hit? _(answer or N/A)_

---

## 10. Auth to a Real External Service (OAuth) — Advanced (only if acting *as* a user)

- **Is this service-to-service (API key) or on-behalf-of-a-user (OAuth)?**
  _(answer or N/A)_
- **If OAuth**: one-time local script for the installed-app flow, printing a
  long-lived refresh token to save as an env var — the server itself must
  never do interactive OAuth (it runs headless). _(answer or N/A)_
- **Required env vars** — name, purpose, required/optional, default. List
  them all; startup must fail fast naming exactly what's missing.
  _(answer or N/A)_

---

## 11. Transport & Lifecycle — Fundamental

- **Transport**: stdio (default/repo convention) or HTTP/SSE?
  _(answer — default stdio unless there's a specific reason not to)_
- **Startup behavior**: does the server seed sample/mock data, or start
  empty? _(answer)_
- **Where do logs go?** Must be `stderr`, never `stdout` (stdout is the
  JSON-RPC channel). Structured (JSON per line: timestamp, level, tool name,
  correlation id) vs. bare strings — bare strings become unreadable once
  calls interleave. _(answer — default: structured, stderr)_
- **Startup failures** (bad config, missing env var): must go through one
  `main().catch(...)` path with a clear "Fatal error starting..." message,
  not an unhandled top-level stack trace. _(confirm)_

---

## 12. Verification Plan — Fundamental

List the specific negative/edge cases to smoke-test, beyond the happy path:

- [ ] Required-field-omitted → validation error
- [ ] Conflict path with the optional key **genuinely omitted** (not just
      populated) — this is where the `undefined !== undefined` bug hides
- [ ] `force`/override path
- [ ] Idempotent retry (same key twice → second call reports "already done",
      no duplicate)
- [ ] One real external-API call end-to-end, if applicable (don't trust the
      mock alone)
- [ ] Simulated `429`/`5xx` → retried; a non-`429` `4xx` → not retried
- _(add domain-specific cases here)_

---

## Handoff

Once every **Fundamental** section is filled in (and any relevant **Advanced**
sections), hand this file to the `mcp-builder` skill / `sdlc-developer` as the
resolved spec — no further requirements-gathering should be needed before
Step 2 (tool surface design) and Step 3 (implementation).
