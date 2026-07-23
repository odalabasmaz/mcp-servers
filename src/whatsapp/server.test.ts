import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "./server.js";

// This server always talks to a real, paired WhatsApp Web session (see
// README.md) — there's no in-memory demo mode to swap in, and driving a real
// headless Chromium session isn't something a unit suite should do. So this
// suite covers what's testable without one: input validation, and every
// tool's behavior while the client is in its default `connecting` state
// (which is exactly the state right after import, since `main()`/
// `client.initialize()` never run under vitest). The rest — chat/message
// listing and sending against a real session — is exercised manually via
// the Inspector, per the "Read this before using it" note in the README.

async function makeClient() {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("whatsapp server", () => {
  let client: Client;

  beforeAll(async () => {
    client = await makeClient();
  });

  it("whatsapp_status reports connectionState even before the client is ready", async () => {
    const result = await client.callTool({ name: "whatsapp_status", arguments: {} });
    const data = JSON.parse((result.content as { type: string; text: string }[])[0].text);
    expect(data.connectionState).toBe("connecting");
  });

  it("list_chats refuses while the client is still connecting", async () => {
    const result = await client.callTool({ name: "list_chats", arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/connecting/i);
  });

  it("get_messages refuses while the client is still connecting", async () => {
    const result = await client.callTool({ name: "get_messages", arguments: { chatId: "491701234567@c.us" } });
    expect(result.isError).toBe(true);
  });

  it("get_messages rejects a missing required field", async () => {
    const result = await client.callTool({ name: "get_messages", arguments: {} });
    expect(result.isError).toBe(true);
  });

  it("send_message refuses while the client is still connecting", async () => {
    const result = await client.callTool({ name: "send_message", arguments: { to: "491701234567", text: "hi" } });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/connecting/i);
  });

  it("send_message rejects missing required fields", async () => {
    const result = await client.callTool({ name: "send_message", arguments: { to: "491701234567" } });
    expect(result.isError).toBe(true);
  });

  it("reply_flow prompt renders with the given focus", async () => {
    const result = await client.getPrompt({ name: "reply_flow", arguments: { focus: "unread chats" } });
    const text = (result.messages[0].content as { text: string }).text;
    expect(text).toMatch(/unread chats/);
  });
});
