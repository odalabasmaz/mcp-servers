# calendar — Design (light template)

## 1. Requirements

- **Server name / domain**: `calendar`
- **What should the model be able to do or ask once this exists?**: Read a
  calendar, find free time, check for conflicts, and book/cancel interview
  events without double-booking.
- **Read-only, mutating, or both?**: Both — 3 read tools, 2 mutating tools
  (conflict-gated + idempotent).
- **Core entity/entities and their key fields**: `Event` — id, title, start,
  end (UTC ISO-8601), attendees, idempotencyKey.
- **Backend**: In-memory by default (seeded with 2 events, zero credentials);
  optional real Google Calendar backend via `CALENDAR_BACKEND=google` (OAuth2
  + refresh token).
- **Anything explicitly out of scope for this pass?**: Recurring events,
  multi-attendee availability negotiation — single-calendar booking only.

## 2. Tools

| Tool name | Purpose | Read-only / Mutating | Key inputs |
|---|---|---|---|
| `list_events` | Events overlapping a UTC range | Read-only | `start`, `end` |
| `find_free_slots` | Gaps of ≥ N minutes in a range | Read-only | `start`, `end`, `minMinutes` |
| `check_conflicts` | Does a proposed window collide? | Read-only | `start`, `end` |
| `schedule_interview` | Book an event; conflict-gated + idempotent | Mutating | `title`, `start`, `end`, `attendees`, `force?`, `idempotencyKey?` |
| `cancel_event` | Cancel an event by id | Mutating | `id` |

## 3. Resources

_(N/A — no resources; all access goes through the read tools above since
callers need range/filter params, not a stable single-ID lookup.)_

## 4. Prompts

| Prompt name | Steps (in order) |
|---|---|
| `schedule_interview_flow` | `find_free_slots` → `check_conflicts` on the chosen slot → `schedule_interview` (with `idempotencyKey`) |
