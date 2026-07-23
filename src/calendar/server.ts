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
 * The calendar itself sits behind a small `CalendarBackend` interface
 * (backend.ts). The default is an in-memory store so the server runs and
 * demos with zero external credentials. Set `CALENDAR_BACKEND=google` (plus
 * OAuth env vars) to point it at a real Google Calendar instead — see
 * "Google Calendar" in README.md. The tools below don't change either way.
 *
 * Transport is stdio, like the infra server.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { CalendarBackend } from "./backend.js";
import { InMemoryCalendarBackend } from "./backend.js";

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

/**
 * `CALENDAR_BACKEND=google` switches to a real Google Calendar (see
 * google-backend.ts + README.md "Google Calendar" for setup). Anything else
 * (including unset) keeps the zero-config in-memory backend, seeded with two
 * events so `list_events` / conflict checks show something out of the box.
 */
async function createBackend(): Promise<CalendarBackend> {
  if (process.env.CALENDAR_BACKEND !== "google") {
    return new InMemoryCalendarBackend([
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
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "CALENDAR_BACKEND=google requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and " +
        "GOOGLE_REFRESH_TOKEN. See GOOGLE_CALENDAR_SETUP.md for how to obtain them " +
        "(npm run google:auth generates the refresh token)."
    );
  }

  const { GoogleCalendarBackend } = await import("./google-backend.js");
  return new GoogleCalendarBackend({
    clientId,
    clientSecret,
    refreshToken,
    writeCalendarId: process.env.GOOGLE_CALENDAR_ID,
    readCalendarIds: process.env.GOOGLE_CALENDAR_IDS,
  });
}

// Assigned in main(), before the transport connects — see there for why
// backend creation is deferred instead of a top-level await.
export let backend: CalendarBackend;

/** Test-only seam: assign `backend` without going through main()/stdio. */
export async function initBackendForTesting(b?: CalendarBackend): Promise<void> {
  backend = b ?? (await createBackend());
}

export const server = new McpServer({
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
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
      calendarId: z
        .string()
        .optional()
        .describe(
          "Which calendar to book into — by name (e.g. 'Health') or ID. Defaults to the " +
            "server's configured write calendar. Ignored by the in-memory backend."
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ title, start, end, attendees, idempotencyKey, force, calendarId }) => {
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

    // Conflict gate: never silently double-book with *other* events. The
    // exact-key match is already handled by `priorSelf` above, so here we only
    // discount another event when *this* request carries a key that matches it.
    // Comparing raw `ev.idempotencyKey !== idempotencyKey` would wrongly cancel
    // out a real conflict when both sides are `undefined` (the keyless common
    // case), letting any keyless booking overlap keyless events unchecked.
    const conflicts = idempotencyKey
      ? overlapping.filter((ev) => ev.idempotencyKey !== idempotencyKey)
      : overlapping;
    if (conflicts.length > 0 && !force) {
      return toolText({
        status: "conflict",
        message: "Proposed time conflicts with existing events. Re-call with force:true to override.",
        overlapping: conflicts,
      });
    }

    // Atomic idempotent insert closes the residual concurrent-retry race.
    let created: boolean;
    let event;
    try {
      ({ event, created } = await backend.create({
        id: randomUUID(),
        title,
        start,
        end,
        attendees,
        idempotencyKey,
        calendarId,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`Failed to schedule the event: ${message}`);
    }
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ id }) => {
    let removed: boolean;
    try {
      removed = await backend.cancel(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`Failed to cancel event '${id}': ${message}`);
    }
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
// Created here (not at module load) so a misconfigured Google backend
  // fails through this function's caller — `main().catch(...)` below — the
  // same clear "Fatal error starting..." path every startup failure takes,
  // rather than an unhandled top-level rejection with a raw stack trace.
  backend = await createBackend();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs MUST go to stderr — stdout is the MCP protocol channel.
  console.error("calendar-mcp-server running on stdio");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error starting calendar-mcp-server:", err);
    process.exit(1);
  });
}
