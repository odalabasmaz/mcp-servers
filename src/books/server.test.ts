import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "./server.js";

async function makeClient() {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const sampleDoc = {
  key: "/works/OL893415W",
  title: "Dune",
  author_name: ["Frank Herbert"],
  first_publish_year: 1965,
  edition_count: 120,
  ebook_access: "borrowable",
  cover_i: 11481354,
  language: ["eng"],
  subject: ["Science fiction"],
};

describe("books server", () => {
  let client: Client;

  beforeAll(async () => {
    client = await makeClient();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a call with no search fields", async () => {
    const result = await client.callTool({ name: "search_books", arguments: { limit: 5, page: 1 } });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/at least one/i);
  });

  it("searches and reshapes OpenLibrary's response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ numFound: 1, start: 0, docs: [sampleDoc] })),
    );

    const result = await client.callTool({ name: "search_books", arguments: { q: "dune", limit: 5, page: 1 } });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as { type: string; text: string }[])[0].text);
    expect(data.numFound).toBe(1);
    expect(data.results[0]).toMatchObject({
      key: "/works/OL893415W",
      title: "Dune",
      authors: ["Frank Herbert"],
      firstPublishYear: 1965,
    });
    expect(data.results[0].coverUrl).toContain("11481354");
  });

  it("surfaces a non-2xx upstream response as a structured error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503, statusText: "Unavailable" })));

    const result = await client.callTool({ name: "search_books", arguments: { q: "dune" } });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/503/);
  });

  it("surfaces a network failure as a structured error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await client.callTool({ name: "search_books", arguments: { title: "dune" } });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/network down/);
  });
});
