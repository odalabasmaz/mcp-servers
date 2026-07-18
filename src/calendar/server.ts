#!/usr/bin/env node
/**
 * calendar-mcp-server
 * -------------------
 * An MCP server that turns a calendar into agent-callable capabilities,
 * themed around scheduling interviews.
 *
 * It goes a step beyond a read-only demo: it has *mutating* tools
 * (schedule / cancel) and therefore has to solve the things a real 3P
 * integration must solve —
 *   - conflict detection before booking (never double-book blindly)
 *   - idempotency (a retried call must not create a duplicate event)
 *   - timezone-safe reasoning (everything is UTC ISO-8601 internally)
 *   - structured errors the client can reason about (isError, not throws)
 *
 * The calendar itself sits behind a small `CalendarBackend` interface. The
 * default is an in-memory store so the server runs and demos with zero
 * external credentials. Swapping in a real Google Calendar / MS Graph
 * adapter is a matter of implementing the same interface — the tools don't
 * change.
 *
 * Transport is stdio, like the infra server.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";

/* -------------------------------------------------------------------------- */
/* Domain                                                                     */
/* -------------------------------------------------------------------------- */

interface CalendarEvent {
  id: string;
  title: string;
  /** UTC ISO-8601, inclusive start. */
  start: string;
  /** UTC ISO-8601, exclusive end. */
  end: string;
  attendees: string[];
  /** Client-supplied key that makes scheduling idempotent. */
  idempotencyKey?: string;
}

/**
 * The seam a real provider plugs into. Keep it tiny: everything the tools
 * need, nothing they don't. A GoogleCalendarBackend would implement this
 * against the Calendar v3 API behind an OAuth2 client.
 */
interface CalendarBackend {
  list(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]>;
  /**
   * Insert an event. Idempotent and atomic: if an event with the same
   * `idempotencyKey` already exists, no new event is created and the existing
   * one is returned with `created: false`. Keeping dedup in the same critical
   * section as the write is what makes a retried call safe under concurrency —
   * a check-then-write in the caller would still race.
   */
  create(event: CalendarEvent): Promise<{ event: CalendarEvent; created: boolean }>;
  cancel(id: string): Promise<boolean>;
}

/** Zero-dependency backend so the server demos offline. */
class InMemoryCalendarBackend implements CalendarBackend {
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

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** True when [aStart,aEnd) and [bStart,bEnd) overlap at all. */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

/** Validates that a value is a parseable ISO-8601 instant. */
const isoInstant = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO-8601 date-time");

/** Shorthand for a structured tool error the client can act on. */
function toolError(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function toolText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/* -------------------------------------------------------------------------- */
/* Server                                                                     */
/* -------------------------------------------------------------------------- */

// A couple of seeded events so `list_events` / conflict checks show something
// out of the box. Times are UTC.
const backend: CalendarBackend = new InMemoryCalendarBackend([
  {
    id: "seed-standup",
    title: "Team standup",
    start: "2026-07-20T09:00:00.000Z",
    end: "2026-07-20T09:30:00.000Z",
    attendees: ["team@example.com"],
  },
  {
    id: "seed-1on1",
    title: "1:1 with manager",
    start: "2026-07-20T14:00:00.000Z",
    end: "2026-07-20T15:00:00.000Z",
    attendees: ["manager@example.com"],
  },
]);

const server = new McpServer({
  name: "calendar-mcp-server",
  version: "1.0.0",
});

/* --- read: list events --------------------------------------------------- */
server.registerTool(
  "list_events",
  {
    title: "List events",
    description:
      "List calendar events overlapping a UTC time range. Read-only. Times are ISO-8601.",
    inputSchema: {
      rangeStart: isoInstant.describe("Range start, UTC ISO-8601"),
      rangeEnd: isoInstant.describe("Range end, UTC ISO-8601"),
    },
  },
  async ({ rangeStart, rangeEnd }) => {
    if (Date.parse(rangeEnd) <= Date.parse(rangeStart)) {
      return toolError("rangeEnd must be after rangeStart.");
    }
    const events = await backend.list(rangeStart, rangeEnd);
    return toolText({ count: events.length, events });
  }
);

/* --- read: find free slots ---------------------------------------------- */
server.registerTool(
  "find_free_slots",
  {
    title: "Find free slots",
    description:
      "Find gaps of at least `durationMinutes` within a UTC range, given existing events. Read-only.",
    inputSchema: {
      rangeStart: isoInstant.describe("Window start, UTC ISO-8601"),
      rangeEnd: isoInstant.describe("Window end, UTC ISO-8601"),
      durationMinutes: z
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .describe("Required slot length in minutes"),
    },
  },
  async ({ rangeStart, rangeEnd, durationMinutes }) => {
    if (Date.parse(rangeEnd) <= Date.parse(rangeStart)) {
      return toolError("rangeEnd must be after rangeStart.");
    }
    const durMs = durationMinutes * 60_000;
    const busy = await backend.list(rangeStart, rangeEnd);

    const slots: { start: string; end: string }[] = [];
    let cursor = Date.parse(rangeStart);
    const windowEnd = Date.parse(rangeEnd);

    for (const ev of busy) {
      const evStart = Date.parse(ev.start);
      if (evStart - cursor >= durMs) {
        slots.push({ start: new Date(cursor).toISOString(), end: new Date(evStart).toISOString() });
      }
      cursor = Math.max(cursor, Date.parse(ev.end));
    }
    if (windowEnd - cursor >= durMs) {
      slots.push({ start: new Date(cursor).toISOString(), end: new Date(windowEnd).toISOString() });
    }

    return toolText({ durationMinutes, freeSlots: slots });
  }
);

/* --- read: check conflicts ---------------------------------------------- */
server.registerTool(
  "check_conflicts",
  {
    title: "Check conflicts",
    description:
      "Check whether a proposed [start,end) window collides with existing events. Read-only — run before scheduling.",
    inputSchema: {
      start: isoInstant.describe("Proposed start, UTC ISO-8601"),
      end: isoInstant.describe("Proposed end, UTC ISO-8601"),
    },
  },
  async ({ start, end }) => {
    if (Date.parse(end) <= Date.parse(start)) {
      return toolError("end must be after start.");
    }
    const overlapping = (await backend.list(start, end)).filter((ev) =>
      overlaps(start, end, ev.start, ev.end)
    );
    return toolText({ conflict: overlapping.length > 0, overlapping });
  }
);

/* --- write: schedule ----------------------------------------------------- */
// A mutating tool. Note the three safety properties:
//   1. it checks conflicts itself and refuses by default,
//   2. it is idempotent via `idempotencyKey`,
//   3. it returns structured results so the model/human can decide next.
server.registerTool(
  "schedule_interview",
  {
    title: "Schedule interview",
    description:
      "Book an interview event. Refuses if it conflicts with an existing event unless `force` is true. " +
      "Pass a stable `idempotencyKey` so retries don't double-book.",
    inputSchema: {
      title: z.string().min(1).describe("Event title, e.g. 'Interview: Jane Doe — Systems'"),
      start: isoInstant.describe("Start, UTC ISO-8601"),
      end: isoInstant.describe("End, UTC ISO-8601"),
      attendees: z.array(z.string().email()).min(1).describe("Attendee emails"),
      idempotencyKey: z
        .string()
        .optional()
        .describe("Stable key to make retries safe; reuse to get the same event back"),
      force: z
        .boolean()
        .default(false)
        .describe("Book even if it conflicts with existing events"),
    },
  },
  async ({ title, start, end, attendees, idempotencyKey, force }) => {
    if (Date.parse(end) <= Date.parse(start)) {
      return toolError("end must be after start.");
    }

    const overlapping = (await backend.list(start, end)).filter((ev) =>
      overlaps(start, end, ev.start, ev.end)
    );

    // A retry of an already-booked slot overlaps *itself* — that's not a
    // conflict, it's idempotency. Detect it first so a retry never looks like
    // a clash with its own prior booking.
    const priorSelf = idempotencyKey
      ? overlapping.find((ev) => ev.idempotencyKey === idempotencyKey)
      : undefined;
    if (priorSelf) {
      return toolText({ status: "already_scheduled", event: priorSelf });
    }

    // Conflict gate: never silently double-book with *other* events.
    const conflicts = overlapping.filter((ev) => ev.idempotencyKey !== idempotencyKey);
    if (conflicts.length > 0 && !force) {
      return toolText({
        status: "conflict",
        message: "Proposed time conflicts with existing events. Re-call with force:true to override.",
        overlapping: conflicts,
      });
    }

    // Atomic idempotent insert closes the residual concurrent-retry race.
    const { event, created } = await backend.create({
      id: randomUUID(),
      title,
      start,
      end,
      attendees,
      idempotencyKey,
    });
    return toolText({
      status: created ? "scheduled" : "already_scheduled",
      forced: created && conflicts.length > 0,
      event,
    });
  }
);

/* --- write: cancel ------------------------------------------------------- */
server.registerTool(
  "cancel_event",
  {
    title: "Cancel event",
    description: "Cancel a previously scheduled event by id.",
    inputSchema: { id: z.string().min(1).describe("Event id to cancel") },
  },
  async ({ id }) => {
    const removed = await backend.cancel(id);
    return removed
      ? toolText({ status: "cancelled", id })
      : toolError(`No event found with id '${id}'.`);
  }
);

/* -------------------------------------------------------------------------- */
/* Prompt                                                                     */
/* -------------------------------------------------------------------------- */

// Chains the tools into the repeatable "find a slot and book it" workflow.
server.registerPrompt(
  "schedule_interview_flow",
  {
    title: "Schedule an interview end-to-end",
    description: "Guide the agent to find a conflict-free slot and book an interview.",
    argsSchema: {
      candidate: z.string().describe("Candidate name, e.g. 'Jane Doe'"),
      durationMinutes: z.string().describe("Interview length in minutes, e.g. '60'"),
      window: z.string().describe("Human window, e.g. 'next Monday 9:00–17:00 UTC'"),
    },
  },
  ({ candidate, durationMinutes, window }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Schedule a ${durationMinutes}-minute interview with ${candidate} within ${window}.`,
            "",
            "Steps:",
            "1. Use `find_free_slots` to list candidate slots in the window.",
            "2. Pick the earliest reasonable slot; use `check_conflicts` to confirm it's clear.",
            "3. Call `schedule_interview` with a stable idempotencyKey.",
            "4. If it returns status 'conflict', report the clash — do NOT force without approval.",
            "Always reason in UTC and echo times back in the attendee's local timezone.",
          ].join("\n"),
        },
      },
    ],
  })
);

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs MUST go to stderr — stdout is the MCP protocol channel.
  console.error("calendar-mcp-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting calendar-mcp-server:", err);
  process.exit(1);
});
