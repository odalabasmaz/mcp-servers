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

const munich = { name: "Munich", country: "Germany", admin1: "Bavaria", latitude: 48.137, longitude: 11.575 };
const springfieldCandidates = [
  { ...munich, name: "Springfield", country: "United States", admin1: "Illinois" },
  { ...munich, name: "Springfield", country: "United States", admin1: "Missouri" },
];

const forecastBody = {
  current: { time: "2026-07-23T12:00", temperature_2m: 20.5, relative_humidity_2m: 43, wind_speed_10m: 9.7, weather_code: 1 },
  daily: {
    time: ["2026-07-23"],
    temperature_2m_min: [16.7],
    temperature_2m_max: [21.9],
    precipitation_sum: [0.1],
    weather_code: [1],
  },
};

function mockFetchByHost(handlers: { geocoding?: unknown[]; forecast?: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: URL) => {
      const u = url instanceof URL ? url : new URL(String(url));
      if (u.hostname.includes("geocoding")) {
        return Promise.resolve(jsonResponse({ results: handlers.geocoding ?? [] }));
      }
      return Promise.resolve(jsonResponse(handlers.forecast ?? forecastBody));
    }),
  );
}

describe("weather server", () => {
  let client: Client;

  beforeAll(async () => {
    client = await makeClient();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("get_weather_by_location resolves a single candidate with no ambiguity", async () => {
    mockFetchByHost({ geocoding: [munich] });

    const result = await client.callTool({
      name: "get_weather_by_location",
      arguments: { location: "Munich, Germany", days: 2 },
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as { type: string; text: string }[])[0].text);
    expect(data.resolvedLocation.name).toBe("Munich");
    expect(data.alternativeMatches).toBe(0);
    expect(data.current.condition).toBe("Mainly clear");
  });

  it("get_weather_by_location reports alternativeMatches for an ambiguous name", async () => {
    mockFetchByHost({ geocoding: springfieldCandidates });

    const result = await client.callTool({
      name: "get_weather_by_location",
      arguments: { location: "Springfield" },
    });
    const data = JSON.parse((result.content as { type: string; text: string }[])[0].text);
    expect(data.alternativeMatches).toBe(1);
  });

  it("get_weather_by_location errors when no location matches", async () => {
    mockFetchByHost({ geocoding: [] });

    const result = await client.callTool({
      name: "get_weather_by_location",
      arguments: { location: "Nowhereville" },
    });
    expect(result.isError).toBe(true);
  });

  it("geocode_location returns all candidates", async () => {
    mockFetchByHost({ geocoding: springfieldCandidates });

    const result = await client.callTool({ name: "geocode_location", arguments: { query: "Springfield" } });
    const data = JSON.parse((result.content as { type: string; text: string }[])[0].text);
    expect(data.count).toBe(2);
  });

  it("get_weather returns current + daily forecast for coordinates", async () => {
    mockFetchByHost({});

    const result = await client.callTool({
      name: "get_weather",
      arguments: { latitude: 48.137, longitude: 11.575, days: 1 },
    });
    const data = JSON.parse((result.content as { type: string; text: string }[])[0].text);
    expect(data.daily).toHaveLength(1);
    expect(data.daily[0].condition).toBe("Mainly clear");
  });

  it("get_weather rejects out-of-range latitude", async () => {
    const result = await client.callTool({
      name: "get_weather",
      arguments: { latitude: 200, longitude: 11.575 },
    });
    expect(result.isError).toBe(true);
  });

  it("surfaces an upstream failure as a structured error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500, statusText: "Error" })));

    const result = await client.callTool({
      name: "get_weather",
      arguments: { latitude: 48.137, longitude: 11.575 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/500/);
  });
});
