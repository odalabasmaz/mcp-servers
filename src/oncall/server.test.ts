import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "./server.js";
import { InMemoryOnCallBackend } from "./backend.js";

async function makeClient() {
  const server = new McpServer({ name: "oncall-test", version: "0.0.0" });
  registerTools(server, new InMemoryOnCallBackend());
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  const isError = result.isError === true;
  return { isError, data: isError ? text : (JSON.parse(text) as any) };
}

const baseIncident = {
  title: "DB connection pool exhausted",
  description: "API pods can't get a DB connection",
  affectedServices: ["api", "checkout"],
  severity: "high" as const,
  ownerTeam: "platform",
};

describe("oncall server", () => {
  let client: Client;

  beforeEach(async () => {
    client = await makeClient();
  });

  it("opens an incident", async () => {
    const { isError, data } = await callTool(client, "open_incident", baseIncident);
    expect(isError).toBe(false);
    expect(data.status).toBe("open");
    expect(data.id).toMatch(/^INC-/);
  });

  it("rejects a missing required field", async () => {
    const { isError, data } = await callTool(client, "open_incident", {
      description: "x",
      affectedServices: ["a"],
      severity: "low",
      ownerTeam: "t",
    });
    expect(isError).toBe(true);
    expect(String(data)).toMatch(/title/i);
  });

  it("open_incident is idempotent via idempotencyKey", async () => {
    const first = await callTool(client, "open_incident", { ...baseIncident, idempotencyKey: "retry-1" });
    const second = await callTool(client, "open_incident", { ...baseIncident, idempotencyKey: "retry-1" });
    expect(second.data.id).toBe(first.data.id);
  });

  it("open_incident without idempotencyKey creates a new incident each call", async () => {
    const first = await callTool(client, "open_incident", baseIncident);
    const second = await callTool(client, "open_incident", baseIncident);
    expect(second.data.id).not.toBe(first.data.id);
  });

  it("acks an open incident", async () => {
    const { data: opened } = await callTool(client, "open_incident", baseIncident);
    const { isError, data } = await callTool(client, "ack_incident", { id: opened.id, assignee: "orhun" });
    expect(isError).toBe(false);
    expect(data.status).toBe("acked");
    expect(data.assignee).toBe("orhun");
  });

  it("ack is idempotent when the same assignee re-acks", async () => {
    const { data: opened } = await callTool(client, "open_incident", baseIncident);
    await callTool(client, "ack_incident", { id: opened.id, assignee: "orhun" });
    const { isError, data } = await callTool(client, "ack_incident", { id: opened.id, assignee: "orhun" });
    expect(isError).toBe(false);
    expect(data.note).toMatch(/idempotent/);
  });

  it("ack conflict: different assignee is rejected without force", async () => {
    const { data: opened } = await callTool(client, "open_incident", baseIncident);
    await callTool(client, "ack_incident", { id: opened.id, assignee: "orhun" });
    const { isError, data } = await callTool(client, "ack_incident", { id: opened.id, assignee: "someone-else" });
    expect(isError).toBe(true);
    expect(String(data)).toMatch(/force/i);
  });

  it("ack conflict: force:true allows reassigning to a different assignee", async () => {
    const { data: opened } = await callTool(client, "open_incident", baseIncident);
    await callTool(client, "ack_incident", { id: opened.id, assignee: "orhun" });
    const { isError, data } = await callTool(client, "ack_incident", {
      id: opened.id,
      assignee: "someone-else",
      force: true,
    });
    expect(isError).toBe(false);
    expect(data.assignee).toBe("someone-else");
  });

  it("rejects acking a resolved incident", async () => {
    const { data: opened } = await callTool(client, "open_incident", baseIncident);
    await callTool(client, "ack_incident", { id: opened.id, assignee: "orhun" });
    await callTool(client, "resolve_incident", { id: opened.id });
    const { isError } = await callTool(client, "ack_incident", { id: opened.id, assignee: "orhun" });
    expect(isError).toBe(true);
  });

  it("rejects resolving an open incident without force", async () => {
    const { data: opened } = await callTool(client, "open_incident", baseIncident);
    const { isError } = await callTool(client, "resolve_incident", { id: opened.id });
    expect(isError).toBe(true);
  });

  it("force:true resolves an open incident directly", async () => {
    const { data: opened } = await callTool(client, "open_incident", baseIncident);
    const { isError, data } = await callTool(client, "resolve_incident", { id: opened.id, force: true });
    expect(isError).toBe(false);
    expect(data.status).toBe("resolved");
  });

  it("resolve is idempotent on retry", async () => {
    const { data: opened } = await callTool(client, "open_incident", baseIncident);
    await callTool(client, "ack_incident", { id: opened.id, assignee: "orhun" });
    const first = await callTool(client, "resolve_incident", { id: opened.id, resolutionNotes: "restarted pool" });
    const second = await callTool(client, "resolve_incident", { id: opened.id, resolutionNotes: "restarted pool" });
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(second.data.note).toMatch(/idempotent/);
  });

  it("lists incidents filtered by status", async () => {
    const { data: a } = await callTool(client, "open_incident", baseIncident);
    await callTool(client, "open_incident", { ...baseIncident, title: "second incident" });
    await callTool(client, "ack_incident", { id: a.id, assignee: "orhun" });

    const { data } = await callTool(client, "list_incidents", { status: "open" });
    expect(data.count).toBe(1);
    expect(data.incidents[0].title).toBe("second incident");
  });

  it("get_incident returns 404-style error for unknown id", async () => {
    const { isError } = await callTool(client, "get_incident", { id: "INC-999" });
    expect(isError).toBe(true);
  });
});
