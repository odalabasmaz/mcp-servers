import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "./server.js";

async function makeClient() {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("infra server", () => {
  let client: Client;

  beforeAll(async () => {
    client = await makeClient();
  });

  it("echo echoes the message back", async () => {
    const result = await client.callTool({ name: "echo", arguments: { message: "hello" } });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(result.isError).toBeFalsy();
    expect(text).toBe("echo: hello");
  });

  it("check_port reports OPEN for a real local listener", async () => {
    const tcp = net.createServer();
    await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));
    const port = (tcp.address() as net.AddressInfo).port;

    try {
      const result = await client.callTool({
        name: "check_port",
        arguments: { host: "127.0.0.1", port, timeoutMs: 1000 },
      });
      const text = (result.content as { type: string; text: string }[])[0].text;
      expect(text).toMatch(/^OPEN/);
    } finally {
      tcp.close();
    }
  });

  it("check_port reports CLOSED for a port nothing listens on", async () => {
    const tcp = net.createServer();
    await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));
    const port = (tcp.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => tcp.close(() => resolve())); // free the port, nothing listens now

    const result = await client.callTool({
      name: "check_port",
      arguments: { host: "127.0.0.1", port, timeoutMs: 1000 },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/^CLOSED/);
  });

  it("check_port rejects an out-of-range port", async () => {
    const result = await client.callTool({
      name: "check_port",
      arguments: { host: "127.0.0.1", port: 70000 },
    });
    expect(result.isError).toBe(true);
  });

  it("system://info resource returns a host snapshot", async () => {
    const result = await client.readResource({ uri: "system://info" });
    const text = (result.contents as { text: string }[])[0].text;
    const info = JSON.parse(text);
    expect(info).toHaveProperty("hostname");
    expect(info).toHaveProperty("platform");
    expect(typeof info.cpus).toBe("number");
  });

  it("diagnose_service prompt renders with the given args", async () => {
    const result = await client.getPrompt({
      name: "diagnose_service",
      arguments: { service: "payments-api", symptom: "5xx spike" },
    });
    const text = (result.messages[0].content as { text: string }).text;
    expect(text).toMatch(/payments-api/);
    expect(text).toMatch(/5xx spike/);
  });
});
