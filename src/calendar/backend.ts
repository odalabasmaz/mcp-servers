/**
 * The `CalendarBackend` seam: everything the tools in server.ts need from a
 * calendar provider, nothing they don't. Swapping providers (in-memory ->
 * Google Calendar -> MS Graph) means implementing this interface — the
 * tools never change.
 */

export interface CalendarEvent {
  id: string;
  title: string;
  /** UTC ISO-8601, inclusive start. */
  start: string;
  /** UTC ISO-8601, exclusive end. */
  end: string;
  attendees: string[];
  /** Client-supplied key that makes scheduling idempotent. */
  idempotencyKey?: string;
  /**
   * Optional target calendar for `create()` — a backend-specific name or ID
   * (e.g. a Google Calendar display name like `"Health"`, or its raw ID).
   * Ignored by `list()`/`cancel()` and by backends with only one calendar
   * (e.g. `InMemoryCalendarBackend`). Falls back to the backend's configured
   * default write calendar when omitted.
   */
  calendarId?: string;
}

export interface CalendarBackend {
  list(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]>;
  /**
   * Insert an event. Idempotent: if an event with the same `idempotencyKey`
   * already exists, no new event is created and the existing one is returned
   * with `created: false`.
   *
   * `InMemoryCalendarBackend` does this atomically (dedup and write share a
   * critical section, so a retried call is safe under concurrency). Real
   * providers such as `GoogleCalendarBackend` do a check-then-insert instead
   * — see that file's doc comment for why that's an accepted, disclosed gap
   * rather than a bug.
   */
  create(event: CalendarEvent): Promise<{ event: CalendarEvent; created: boolean }>;
  cancel(id: string): Promise<boolean>;
}

/** Zero-dependency backend so the server demos offline. */
export class InMemoryCalendarBackend implements CalendarBackend {
  private events: CalendarEvent[] = [];

  constructor(seed: CalendarEvent[] = []) {
    this.events = [...seed];
  }

  async list(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]> {
    const s = Date.parse(rangeStart);
    const e = Date.parse(rangeEnd);
    return this.events
      .filter((ev) => Date.parse(ev.end) > s && Date.parse(ev.start) < e)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  }

  async create(event: CalendarEvent): Promise<{ event: CalendarEvent; created: boolean }> {
    if (event.idempotencyKey) {
      const existing = this.events.find((ev) => ev.idempotencyKey === event.idempotencyKey);
      if (existing) return { event: existing, created: false };
    }
    this.events.push(event);
    return { event, created: true };
  }

  async cancel(id: string): Promise<boolean> {
    const before = this.events.length;
    this.events = this.events.filter((ev) => ev.id !== id);
    return this.events.length < before;
  }
}
