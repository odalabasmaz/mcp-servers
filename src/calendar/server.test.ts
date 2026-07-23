import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server, initBackendForTesting } from "./server.js";
import { InMemoryCalendarBackend } from "./backend.js";

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  const isError = result.isError === true;
  return { isError, data: isError ? text : (JSON.parse(text) as any) };
}

const SEED_STANDUP_START = "2026-07-20T09:00:00.000Z";
const SEED_STANDUP_END = "2026-07-20T09:30:00.000Z";

describe("calendar server", () => {
  let client: Client;

  beforeEach(async () => {
    await initBackendForTesting(
      new InMemoryCalendarBackend([
        {
          id: "seed-standup",
          title: "Team standup",
          start: SEED_STANDUP_START,
          end: SEED_STANDUP_END,
          attendees: ["team@example.com"],
        },
      ]),
    );
    client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("lists events overlapping a range", async () => {
    const { data } = await callTool(client, "list_events", {
      rangeStart: "2026-07-20T00:00:00.000Z",
      rangeEnd: "2026-07-21T00:00:00.000Z",
    });
    expect(data.count).toBe(1);
    expect(data.events[0].id).toBe("seed-standup");
  });

  it("rejects an inverted range", async () => {
    const { isError } = await callTool(client, "list_events", {
      rangeStart: "2026-07-21T00:00:00.000Z",
      rangeEnd: "2026-07-20T00:00:00.000Z",
    });
    expect(isError).toBe(true);
  });

  it("finds free slots around the seeded event", async () => {
    const { data } = await callTool(client, "find_free_slots", {
      rangeStart: "2026-07-20T09:00:00.000Z",
      rangeEnd: "2026-07-20T11:00:00.000Z",
      durationMinutes: 30,
    });
    expect(data.freeSlots).toContainEqual({
      start: SEED_STANDUP_END,
      end: "2026-07-20T11:00:00.000Z",
    });
  });

  it("check_conflicts reports a collision with the seeded event", async () => {
    const { data } = await callTool(client, "check_conflicts", {
      start: "2026-07-20T09:15:00.000Z",
      end: "2026-07-20T09:45:00.000Z",
    });
    expect(data.conflict).toBe(true);
  });

  it("check_conflicts reports no collision for a free window", async () => {
    const { data } = await callTool(client, "check_conflicts", {
      start: "2026-07-20T10:00:00.000Z",
      end: "2026-07-20T10:30:00.000Z",
    });
    expect(data.conflict).toBe(false);
  });

  it("schedule_interview rejects required-field-omitted input", async () => {
    const { isError } = await callTool(client, "schedule_interview", {
      start: "2026-07-20T10:00:00.000Z",
      end: "2026-07-20T10:30:00.000Z",
      attendees: ["jane@example.com"],
    });
    expect(isError).toBe(true);
  });

  it("schedule_interview books a free slot", async () => {
    const { data } = await callTool(client, "schedule_interview", {
      title: "Interview: Jane Doe",
      start: "2026-07-20T10:00:00.000Z",
      end: "2026-07-20T10:30:00.000Z",
      attendees: ["jane@example.com"],
    });
    expect(data.status).toBe("scheduled");
  });

  it("schedule_interview refuses a conflicting slot without force, keyless (the war-story case)", async () => {
    const { data } = await callTool(client, "schedule_interview", {
      title: "Interview: Jane Doe",
      start: "2026-07-20T09:15:00.000Z",
      end: "2026-07-20T09:45:00.000Z",
      attendees: ["jane@example.com"],
    });
    expect(data.status).toBe("conflict");
  });

  it("schedule_interview books a conflicting slot when force:true", async () => {
    const { data } = await callTool(client, "schedule_interview", {
      title: "Interview: Jane Doe",
      start: "2026-07-20T09:15:00.000Z",
      end: "2026-07-20T09:45:00.000Z",
      attendees: ["jane@example.com"],
      force: true,
    });
    expect(data.status).toBe("scheduled");
    expect(data.forced).toBe(true);
  });

  it("schedule_interview is idempotent on retry with the same key", async () => {
    const args = {
      title: "Interview: Jane Doe",
      start: "2026-07-20T10:00:00.000Z",
      end: "2026-07-20T10:30:00.000Z",
      attendees: ["jane@example.com"],
      idempotencyKey: "retry-1",
    };
    const first = await callTool(client, "schedule_interview", args);
    const second = await callTool(client, "schedule_interview", args);
    expect(first.data.event.id).toBe(second.data.event.id);
    expect(second.data.status).toBe("already_scheduled");
  });

  it("cancel_event removes an event by id", async () => {
    const { isError, data } = await callTool(client, "cancel_event", { id: "seed-standup" });
    expect(isError).toBe(false);
    expect(data.status).toBe("cancelled");

    const { data: listed } = await callTool(client, "list_events", {
      rangeStart: "2026-07-20T00:00:00.000Z",
      rangeEnd: "2026-07-21T00:00:00.000Z",
    });
    expect(listed.count).toBe(0);
  });

  it("cancel_event errors for an unknown id", async () => {
    const { isError } = await callTool(client, "cancel_event", { id: "does-not-exist" });
    expect(isError).toBe(true);
  });
});
