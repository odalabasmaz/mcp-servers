# Google Calendar setup

Point `calendar-mcp-server` at your own Google Calendar instead of the
in-memory demo data. This is meant for **personal testing** (OAuth2 + a
refresh token you hold), not a server-to-server production setup.

---

## 1. Create an OAuth client

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project (or pick an existing one).
2. **APIs & Services → Library** → enable the **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → set it up for **External** +
   your own Google account as a **test user** (no verification/review needed
   for personal test use — test users work indefinitely).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** →
   application type **Desktop app**. Note the **Client ID** and **Client
   secret** — Desktop-app clients support the loopback redirect
   (`http://localhost:<port>/...`) the helper script below uses, with nothing
   extra to register.

## 2. Get a refresh token

Run the repo's helper script once, from the repo root:

```bash
GOOGLE_CLIENT_ID=your-client-id \
GOOGLE_CLIENT_SECRET=your-client-secret \
npm run google:auth
```

It prints a URL — open it, sign in, approve access. It then prints:

```
GOOGLE_REFRESH_TOKEN=1//...
```

Save that; it doesn't expire from use (only if revoked, unused for ~6 months,
or the OAuth consent screen is still in "Testing" and you exceed 100 test
users — not a concern for solo use).

## 3. Configure the server

Environment variables the `google` backend reads:

| Var | Required | Purpose |
|-----|----------|---------|
| `CALENDAR_BACKEND` | yes | Set to `google` to opt in (anything else = in-memory) |
| `GOOGLE_CLIENT_ID` | yes | From step 1 |
| `GOOGLE_CLIENT_SECRET` | yes | From step 1 |
| `GOOGLE_REFRESH_TOKEN` | yes | From step 2 |
| `GOOGLE_CALENDAR_ID` | no | Default calendar `schedule_interview` **writes** to. Name (e.g. `Health`) or ID. Defaults to `primary`. |
| `GOOGLE_CALENDAR_IDS` | no | Which calendar(s) `list_events`/`find_free_slots`/`check_conflicts` **read**. See "Multiple calendars" below. Defaults to just `GOOGLE_CALENDAR_ID`. |

Everywhere a calendar is configured, you can use either its **display name**
(what you see in the Google Calendar sidebar, e.g. `Health`) or its raw
**calendar ID** — names are resolved to IDs automatically (case-insensitive
exact match) via `calendarList.list`, cached for the process lifetime.

**Inspector:**

```bash
CALENDAR_BACKEND=google \
GOOGLE_CLIENT_ID=your-client-id \
GOOGLE_CLIENT_SECRET=your-client-secret \
GOOGLE_REFRESH_TOKEN=your-refresh-token \
npm run inspect:calendar
```

**Claude Code** (env vars via `-e`):

```bash
claude mcp add calendar --scope user \
  -e CALENDAR_BACKEND=google \
  -e GOOGLE_CLIENT_ID=your-client-id \
  -e GOOGLE_CLIENT_SECRET=your-client-secret \
  -e GOOGLE_REFRESH_TOKEN=your-refresh-token \
  -- node /Users/odalabasmaz/workspace/mcp-servers/dist/calendar/server.js
```

If `calendar` is already registered pointing at the in-memory backend, remove
it first (`claude mcp remove calendar`) before re-adding with the Google env
vars — `claude mcp add` doesn't merge into an existing entry.

Missing/misconfigured Google env vars fail fast at startup with a clear
message (`Fatal error starting calendar-mcp-server: CALENDAR_BACKEND=google
requires ...`) rather than falling back silently to in-memory.

---

## Multiple calendars

By default, `list_events` / `find_free_slots` / `check_conflicts` only read
**one** calendar — same as `schedule_interview`'s write target
(`GOOGLE_CALENDAR_ID`, default `primary`). If you have several calendars
(work, personal, a shared team calendar, ...) and want reads/conflict-checks
to see across all of them, set `GOOGLE_CALENDAR_IDS` (plural):

- **A specific list**, comma-separated calendar IDs:
  ```bash
  GOOGLE_CALENDAR_IDS="primary,work@group.calendar.google.com,family12345@group.calendar.google.com"
  ```
  Find a calendar's ID in Google Calendar → the calendar's **Settings and
  sharing** page → **Integrate calendar** → **Calendar ID**.

- **Every calendar you have selected/visible**, via auto-discovery:
  ```bash
  GOOGLE_CALENDAR_IDS=all
  ```
  This calls the Calendar API's `calendarList.list` once at first read and
  caches the result for the life of the process — it only includes calendars
  marked "selected" (checked/visible in your Google Calendar UI), which
  matches what you'd see if you opened calendar.google.com. Restart the
  server if you change which calendars are selected in the UI.

`schedule_interview` still **writes** to a single calendar by default
(`GOOGLE_CALENDAR_ID`) even when reads span many — "check my whole calendar
for conflicts" and "book onto calendar X" are different questions, and
picking one calendar to write to avoids ambiguity about where a new event
should live. `cancel_event` searches the write calendar first, then falls
back through the read calendars, so it can cancel events regardless of which
calendar they're actually on.

### Booking into a specific calendar per call

`schedule_interview` also takes an optional `calendarId` argument (name or
ID) that overrides `GOOGLE_CALENDAR_ID` for just that one booking — e.g. ask
the agent to "schedule this in my Health calendar" and it can pass
`calendarId: "Health"` without you reconfiguring the server. Same name
resolution rules apply.

Example — read across all your calendars, write new bookings to `primary`:

```bash
claude mcp add calendar --scope user \
  -e CALENDAR_BACKEND=google \
  -e GOOGLE_CLIENT_ID=your-client-id \
  -e GOOGLE_CLIENT_SECRET=your-client-secret \
  -e GOOGLE_REFRESH_TOKEN=your-refresh-token \
  -e GOOGLE_CALENDAR_IDS=all \
  -- node /Users/odalabasmaz/workspace/mcp-servers/dist/calendar/server.js
```

---

## Troubleshooting: "I can see a calendar but can't add events to it"

This is two different problems depending on which calendar:

**A calendar you created yourself** (e.g. a second calendar named `Health`)
— if writes fail here, it's almost always that a raw calendar **name** was
being sent to the Google API where it expects an **ID** (`"Health"` is not a
valid `calendarId`; something like `abc123...@group.calendar.google.com` is).
This server now resolves names to IDs automatically (see above) — set
`GOOGLE_CALENDAR_ID=Health` or pass `calendarId: "Health"` per call and it
should work. If it still fails, the tool's error message will now include
the real Google API error (rather than crashing silently) — check for a 404
("no such calendar", meaning the name didn't resolve — verify the exact
spelling matches the calendar's display name).

**A calendar owned by someone else** (a teammate, a shared team calendar) —
if you can *see* it but writes fail with a 403, this is a genuine **Google
Calendar sharing permission**, not something this server can work around.
Google has four access levels per calendar, granted by its owner:

1. See only free/busy
2. See all event details
3. **Make changes to events** ← you need at least this to book onto it
4. Make changes and manage sharing

Ask the calendar's owner to raise your access to at least level 3: they go
to the calendar in Google Calendar → **Settings and sharing** → **Share
with specific people** → find your account → set permission to **"Make
changes to events."** There's no server-side setting that substitutes for
this — `create()` will surface the Google API's 403 as a clear tool error
(`"HTTP 403 Forbidden — insufficient permission on this calendar"`) so it's
distinguishable from a resolution/config problem, but the fix has to happen
on the calendar owner's side in Google Calendar itself.

---

## Concurrency note (Google backend specifically)

Idempotency dedup here is check-then-insert against the Calendar API (list
by `idempotencyKey` extended property, then insert), not atomic like the
in-memory backend — Calendar v3 has no compare-and-swap. Fine for
interactive/manual testing; a production integration would need its own
idempotency store in front of Calendar. With `GOOGLE_CALENDAR_IDS` set to
multiple calendars, the idempotency lookup checks each read calendar in turn
before falling through to insert.
