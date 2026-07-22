/**
 * `CalendarBackend` implementation against the real Google Calendar API
 * (Calendar v3), for testing the calendar-mcp-server tools against your own
 * calendar instead of the in-memory seed data.
 *
 * Auth is OAuth2 with a long-lived refresh token (installed-app flow) — see
 * `scripts/get-google-refresh-token.ts` and `GOOGLE_CALENDAR_SETUP.md` for
 * how to obtain one. There is no service-account/domain-wide delegation path
 * here; this is meant for "point it at my personal Google Calendar to try it
 * out," not a server-to-server production integration.
 *
 * Multiple calendars: a Google account can have many calendars (personal,
 * shared, holidays, ...), but Calendar v3 has no single endpoint that reads
 * across all of them at once — every call is scoped to one `calendarId`.
 * `readCalendarIds` (plural) is the set queried for `list()` /
 * `find_free_slots` / `check_conflicts` / idempotency lookups; `writeCalendarId`
 * (singular, overridable per-call via `CalendarEvent.calendarId`) is where
 * `create()` inserts new events. They're separate because "check my whole
 * calendar for conflicts" and "book onto calendar X" are different questions
 * — see GOOGLE_CALENDAR_SETUP.md "Multiple calendars".
 *
 * Calendar names vs IDs: everywhere a calendar is specified (env config or
 * per-call), it can be either a real Google calendar ID or a human-readable
 * display name (e.g. `"Health"`) — `resolveCalendarId()` looks names up via
 * `calendarList.list` and caches the result. `"primary"` is always passed
 * through as-is (it's Google's own special-case ID, not a display name).
 *
 * Permissions: resolving a name to an ID only means the calendar is visible
 * to this account (`calendarList.list` includes anything you can see,
 * including calendars shared with you as read-only). It does NOT mean you
 * can write to it — Google enforces that separately via each calendar's
 * sharing ACL, and `create()`/`cancel()` surface that as a normal thrown
 * error (403 from the API) if you lack "Make changes to events" permission
 * on the target calendar. No amount of code here can grant an ACL Google
 * hasn't granted; see GOOGLE_CALENDAR_SETUP.md "Troubleshooting".
 *
 * Concurrency note: unlike `InMemoryCalendarBackend`, idempotency dedup here
 * is check-then-insert (`findByIdempotencyKey` then `events.insert`), not
 * atomic — Calendar v3 has no compare-and-swap primitive for this. Two
 * concurrent retries with the same key could both pass the check and create
 * duplicate events. Acceptable for interactive/manual use (the case this is
 * built for); a production integration would need either a idempotency store
 * in front of Calendar or accept periodic de-duplication.
 */
import { google, calendar_v3 } from "googleapis";
import type { CalendarBackend, CalendarEvent } from "./backend.js";

export interface GoogleCalendarBackendOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Calendar `create()` writes new events to by default. Name or ID; defaults to `primary`. */
  writeCalendarId?: string;
  /**
   * Calendar(s) `list()`/conflict-checking/idempotency-lookup read from.
   * Comma-separated calendar names/IDs, or the literal `"all"` to
   * auto-discover every calendar the account has selected
   * (`calendarList.list`). Defaults to just `writeCalendarId` — i.e. the old
   * single-calendar behavior.
   */
  readCalendarIds?: string;
}

interface KnownCalendar {
  id: string;
  summary: string;
  selected: boolean;
}

export class GoogleCalendarBackend implements CalendarBackend {
  private readonly calendar: calendar_v3.Calendar;
  private readonly writeCalendarId: string;
  private readonly readCalendarIdsConfig: string | undefined;
  /** Lazily fetched (and cached) on first calendar-name resolution or "all" discovery. */
  private knownCalendars: KnownCalendar[] | undefined;

  constructor(opts: GoogleCalendarBackendOptions) {
    const auth = new google.auth.OAuth2(opts.clientId, opts.clientSecret);
    auth.setCredentials({ refresh_token: opts.refreshToken });
    this.calendar = google.calendar({ version: "v3", auth });
    this.writeCalendarId = opts.writeCalendarId ?? "primary";
    this.readCalendarIdsConfig = opts.readCalendarIds;
  }

  async list(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]> {
    const calendarIds = await this.resolveReadCalendarIds();
    const perCalendar = await Promise.all(
      calendarIds.map((calendarId) =>
        this.calendar.events.list({
          calendarId,
          timeMin: rangeStart,
          timeMax: rangeEnd,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250,
        })
      )
    );
    const events = perCalendar.flatMap((res) => (res.data.items ?? []).map(toCalendarEvent));
    return events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  }

  async create(event: CalendarEvent): Promise<{ event: CalendarEvent; created: boolean }> {
    if (event.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(event.idempotencyKey);
      if (existing) return { event: existing, created: false };
    }

    const calendarId = await this.resolveCalendarId(event.calendarId ?? this.writeCalendarId);

    let res;
    try {
      res = await this.calendar.events.insert({
        calendarId,
        requestBody: {
          summary: event.title,
          start: { dateTime: event.start, timeZone: "UTC" },
          end: { dateTime: event.end, timeZone: "UTC" },
          attendees: event.attendees.map((email) => ({ email })),
          extendedProperties: event.idempotencyKey
            ? { private: { idempotencyKey: event.idempotencyKey } }
            : undefined,
        },
      });
    } catch (err) {
      throw new Error(
        `Google Calendar rejected creating the event on calendar '${event.calendarId ?? this.writeCalendarId}' ` +
          `(resolved to '${calendarId}'): ${describeGoogleError(err)}. If you can see this calendar but can't ` +
          `write to it, you likely only have read/free-busy access — see GOOGLE_CALENDAR_SETUP.md 'Troubleshooting'.`
      );
    }
    return { event: toCalendarEvent(res.data), created: true };
  }

  async cancel(id: string): Promise<boolean> {
    // Most cancellations target something this server booked, so try the
    // write calendar first — avoids an extra round-trip in the common case.
    const writeId = await this.resolveCalendarId(this.writeCalendarId);
    const calendarIds = [writeId, ...(await this.resolveReadCalendarIds())];
    const tried = new Set<string>();
    for (const calendarId of calendarIds) {
      if (tried.has(calendarId)) continue;
      tried.add(calendarId);
      try {
        await this.calendar.events.delete({ calendarId, eventId: id });
        return true;
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    }
    return false;
  }

  private async findByIdempotencyKey(key: string): Promise<CalendarEvent | undefined> {
    const calendarIds = await this.resolveReadCalendarIds();
    for (const calendarId of calendarIds) {
      const res = await this.calendar.events.list({
        calendarId,
        privateExtendedProperty: [`idempotencyKey=${key}`],
        singleEvents: true,
        maxResults: 1,
      });
      const item = res.data.items?.[0];
      if (item) return toCalendarEvent(item);
    }
    return undefined;
  }

  private async resolveReadCalendarIds(): Promise<string[]> {
    if (!this.readCalendarIdsConfig) return [await this.resolveCalendarId(this.writeCalendarId)];

    if (this.readCalendarIdsConfig === "all") {
      const known = await this.loadKnownCalendars();
      const selected = known.filter((cal) => cal.selected).map((cal) => cal.id);
      // Fall back to the write calendar if discovery somehow returns nothing
      // (e.g. no calendars marked "selected") so reads never silently go empty.
      return selected.length > 0 ? selected : [await this.resolveCalendarId(this.writeCalendarId)];
    }

    const names = this.readCalendarIdsConfig
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    return Promise.all(names.map((name) => this.resolveCalendarId(name)));
  }

  /** Resolves a calendar name (e.g. "Health") or raw ID to a real Google calendar ID. */
  private async resolveCalendarId(nameOrId: string): Promise<string> {
    if (nameOrId === "primary") return nameOrId;

    const known = await this.loadKnownCalendars();
    const byId = known.find((cal) => cal.id === nameOrId);
    if (byId) return byId.id;

    const byName = known.find((cal) => cal.summary.toLowerCase() === nameOrId.toLowerCase());
    if (byName) return byName.id;

    // Not a known name or ID — pass it through as-is (it may be a calendar ID
    // this account can access but that calendarList didn't happen to include,
    // e.g. a resource calendar added by ID rather than "subscribed" to) and
    // let the Google API's own error explain if it's genuinely invalid.
    return nameOrId;
  }

  private async loadKnownCalendars(): Promise<KnownCalendar[]> {
    if (!this.knownCalendars) {
      const res = await this.calendar.calendarList.list();
      this.knownCalendars = (res.data.items ?? [])
        .filter((cal): cal is calendar_v3.Schema$CalendarListEntry & { id: string } => Boolean(cal.id))
        .map((cal) => ({
          id: cal.id,
          summary: cal.summary ?? cal.id,
          selected: cal.selected === true,
        }));
    }
    return this.knownCalendars;
  }
}

function isNotFound(err: unknown): boolean {
  const status = (err as { code?: number; response?: { status?: number } })?.response?.status
    ?? (err as { code?: number })?.code;
  return status === 404 || status === 410;
}

function describeGoogleError(err: unknown): string {
  const status = (err as { code?: number; response?: { status?: number } })?.response?.status
    ?? (err as { code?: number })?.code;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 403) return `HTTP 403 Forbidden — insufficient permission on this calendar (${message})`;
  if (status === 404) return `HTTP 404 Not Found — no such calendar (${message})`;
  return message;
}

function toCalendarEvent(item: calendar_v3.Schema$Event): CalendarEvent {
  return {
    id: item.id ?? "",
    title: item.summary ?? "(no title)",
    start: item.start?.dateTime ?? item.start?.date ?? "",
    end: item.end?.dateTime ?? item.end?.date ?? "",
    attendees: (item.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    idempotencyKey: item.extendedProperties?.private?.idempotencyKey ?? undefined,
  };
}
