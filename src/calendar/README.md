# calendar-mcp-server

An MCP server that exposes calendar operations to an agent — themed around
scheduling interviews without double-booking.

---

## What is it

A Model Context Protocol server whose tools let an agent read a calendar, find
open time, and **book / cancel** events. Unlike a read-only demo, it has
mutating tools, so it shows the things a real 3rd-party integration has to get
right:

- **Conflict detection** — `schedule_interview` refuses to overlap an existing
  event unless you explicitly `force` it.
- **Idempotency** — pass a stable `idempotencyKey`; a retried call returns the
  same event instead of creating a duplicate.
- **Timezone-safe** — everything is UTC ISO-8601 internally.
- **Structured errors** — invalid input comes back as a typed error the client
  can reason about, not a thrown exception.

The calendar lives behind a small `CalendarBackend` interface
([`backend.ts`](backend.ts)). The default is an **in-memory** backend (seeded
with two events) so the server runs and demos with **zero credentials**. Set
`CALENDAR_BACKEND=google` to point it at a real **Google Calendar** instead —
see [GOOGLE_CALENDAR_SETUP.md](GOOGLE_CALENDAR_SETUP.md) (includes reading
across multiple calendars). Either way the tools don't change; only the
`CalendarBackend` implementation underneath does.

### What it exposes

| Name | Kind | Purpose |
|------|------|---------|
| `list_events` | tool (read) | Events overlapping a UTC range |
| `find_free_slots` | tool (read) | Gaps of ≥ N minutes in a range |
| `check_conflicts` | tool (read) | Does a proposed window collide? Run before booking |
| `schedule_interview` | tool (write) | Book an event; conflict-gated + idempotent |
| `cancel_event` | tool (write) | Cancel an event by id |
| `schedule_interview_flow` | prompt | Chains the tools into "find a slot and book it" |

> **Concurrency note (default in-memory backend):** idempotency is atomic
> (safe under concurrent retries). Cross-event conflict detection is
> check-then-act — correct for sequential MCP clients (the normal case); a
> production backend would lean on the provider's transactional guarantees /
> ETags to close the read-write race. The optional Google Calendar backend has
> a different, weaker guarantee for idempotency — see
> [GOOGLE_CALENDAR_SETUP.md](GOOGLE_CALENDAR_SETUP.md).

---

## How to use

Run from the **repo root** (build is shared across all servers):

```bash
npm install
npm run build
```

### Interactive UI (MCP Inspector)

```bash
npm run inspect:calendar
```

Lists/calls the tools and renders the prompt in a local UI.

### Register with an MCP client (e.g. Claude Code)

```bash
claude mcp add calendar --scope user -- \
  node /Users/odalabasmaz/workspace/mcp-servers/dist/calendar/server.js
```

Then `claude mcp list` shows it, and `/mcp` in a session lists its tools.

### Quick sanity check (raw JSON-RPC)

Tries to book a slot that overlaps the seeded 09:00 standup — expect
`status: "conflict"`:

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"c","version":"0"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"schedule_interview","arguments":{"title":"Interview: Jane Doe","start":"2026-07-20T09:15:00.000Z","end":"2026-07-20T10:00:00.000Z","attendees":["jane@example.com"]}}}' \
| node dist/calendar/server.js
```

To book, pick a free slot (the seed calendar is busy 09:00–09:30 and 14:00–15:00
UTC on 2026-07-20) and add a stable `idempotencyKey` so retries are safe.

---

## Google Calendar

Point the server at your own Google Calendar instead of the in-memory demo
data (OAuth2 + a refresh token you hold — meant for personal testing, not a
server-to-server production setup).

See **[GOOGLE_CALENDAR_SETUP.md](GOOGLE_CALENDAR_SETUP.md)** for the full
walkthrough: creating an OAuth client, getting a refresh token, the env var
reference, registering with Claude Code, reading across **multiple
calendars**, and the concurrency caveat specific to this backend.

---

## Layout

```
src/calendar/server.ts                          # tools, prompt, backend selection
src/calendar/backend.ts                         # CalendarBackend interface + InMemoryCalendarBackend
src/calendar/google-backend.ts                   # GoogleCalendarBackend (Calendar v3)
src/calendar/scripts/get-google-refresh-token.ts # one-time OAuth helper (npm run google:auth)
src/calendar/GOOGLE_CALENDAR_SETUP.md           # Google Calendar setup guide
src/calendar/README.md                          # this file
```
