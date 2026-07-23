#!/usr/bin/env node
/**
 * weather-mcp-server
 * ------------------
 * An MCP server that exposes weather lookups via the Open-Meteo APIs
 * (https://open-meteo.com/) — geocoding + forecast, both free and
 * keyless, which keeps this server zero-config like the others.
 *
 * Three read-only tools:
 *   - `get_weather_by_location` : place name -> weather at the best-ranked match.
 *                                 The convenience path for "what's the weather
 *                                 in X" — one call, no coordinates needed.
 *   - `geocode_location`        : place name -> ALL candidate lat/lon matches.
 *   - `get_weather`             : lat/lon    -> current conditions + daily forecast.
 *
 * `geocode_location` + `get_weather` stay separate (and available) for the
 * case `get_weather_by_location` can't resolve well on its own: a bare place
 * name ("Springfield", "Munich") can match many real-world locations, and
 * Open-Meteo's own ranking (roughly by population) is only a guess at intent.
 * `get_weather_by_location` reports how many other candidates existed so a
 * caller can tell when its guess might be wrong and fall back to the two-step
 * geocode -> pick -> get_weather flow (`weather_briefing` documents that).
 * Qualifying the query — "Munich, Germany" / "Springfield, Illinois" — is
 * usually enough to disambiguate without the two-step flow at all.
 *
 * Transport is stdio, like the other servers in this repo.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const REQUEST_TIMEOUT_MS = 8_000;

// WMO weather codes (shared by both Open-Meteo endpoints) -> short text.
// https://open-meteo.com/en/docs#weathervariables
const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function describeWeatherCode(code: number): string {
  return WMO_CODES[code] ?? `Unknown (WMO code ${code})`;
}

export const server = new McpServer({
  name: "weather-mcp-server",
  version: "1.0.0",
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toolError(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function toolText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

async function fetchJson(url: URL): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Open-Meteo returned HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

interface GeocodeResult {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  population?: number;
}

/** Shared by `geocode_location` and `get_weather_by_location`. */
async function geocode(query: string, count: number): Promise<GeocodeResult[]> {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const data = await fetchJson(url);
  return (data.results ?? []).map((r: any) => ({
    name: r.name,
    country: r.country,
    admin1: r.admin1,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
    population: r.population,
  }));
}

interface ForecastResult {
  current?: {
    time: string;
    temperatureC: number;
    humidityPct: number;
    windSpeedKmh: number;
    condition: string;
  };
  daily: { date: string; minTempC: number; maxTempC: number; precipitationMm: number; condition: string }[];
}

/** Shared by `get_weather` and `get_weather_by_location`. */
async function forecast(latitude: number, longitude: number, days: number): Promise<ForecastResult> {
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("forecast_days", String(days));

  const data = await fetchJson(url);

  const current = data.current
    ? {
        time: data.current.time,
        temperatureC: data.current.temperature_2m,
        humidityPct: data.current.relative_humidity_2m,
        windSpeedKmh: data.current.wind_speed_10m,
        condition: describeWeatherCode(data.current.weather_code),
      }
    : undefined;

  const daily = (data.daily?.time ?? []).map((date: string, i: number) => ({
    date,
    minTempC: data.daily.temperature_2m_min[i],
    maxTempC: data.daily.temperature_2m_max[i],
    precipitationMm: data.daily.precipitation_sum[i],
    condition: describeWeatherCode(data.daily.weather_code[i]),
  }));

  return { current, daily };
}

/* -------------------------------------------------------------------------- */
/* Tools                                                                      */
/* -------------------------------------------------------------------------- */

server.registerTool(
  "get_weather_by_location",
  {
    title: "Get weather by place name",
    description:
      "Weather for a place name in one call — resolves it to coordinates (Open-Meteo " +
      "geocoding) and fetches current conditions + daily forecast. Read-only. Use this " +
      "by default; qualify ambiguous names with a country/state, e.g. 'Munich, Germany' " +
      "or 'Springfield, Illinois'. If `alternativeMatches` in the result is > 0 and the " +
      "resolved location looks wrong, fall back to `geocode_location` + `get_weather` to " +
      "pick the right one explicitly.",
    inputSchema: {
      location: z.string().min(1).describe("Place name, e.g. 'Munich, Germany'"),
      days: z.number().int().min(1).max(16).default(3).describe("Number of forecast days, 1-16"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ location, days }) => {
    let candidates: GeocodeResult[];
    try {
      candidates = await geocode(location, 5);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`Geocoding failed: ${message}`);
    }

    if (candidates.length === 0) {
      return toolError(`No location found matching '${location}'.`);
    }
    const best = candidates[0];

    let weather: ForecastResult;
    try {
      weather = await forecast(best.latitude, best.longitude, days);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`Weather lookup failed: ${message}`);
    }

    return toolText({
      resolvedLocation: {
        name: best.name,
        country: best.country,
        admin1: best.admin1,
        latitude: best.latitude,
        longitude: best.longitude,
      },
      alternativeMatches: candidates.length - 1,
      ...weather,
    });
  }
);

server.registerTool(
  "geocode_location",
  {
    title: "Geocode a place name",
    description:
      "Resolve a place name (city, town, etc.) to ALL candidate lat/lon matches via " +
      "Open-Meteo's geocoding API. Read-only. Use this + `get_weather` instead of " +
      "`get_weather_by_location` when you need to see and choose between multiple " +
      "same-named places yourself.",
    inputSchema: {
      query: z.string().min(1).describe("Place name, e.g. 'Frankfurt' or 'Springfield'"),
      count: z.number().int().min(1).max(20).default(5).describe("Max candidates to return"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ query, count }) => {
    let results: GeocodeResult[];
    try {
      results = await geocode(query, count);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`Geocoding failed: ${message}`);
    }
    return toolText({ query, count: results.length, results });
  }
);

server.registerTool(
  "get_weather",
  {
    title: "Get weather by coordinates",
    description:
      "Current conditions + daily forecast for a lat/lon via Open-Meteo. Read-only. " +
      "Prefer `get_weather_by_location` if you only have a place name and don't need " +
      "to disambiguate between candidates yourself.",
    inputSchema: {
      latitude: z.number().min(-90).max(90).describe("Latitude, decimal degrees"),
      longitude: z.number().min(-180).max(180).describe("Longitude, decimal degrees"),
      days: z.number().int().min(1).max(16).default(3).describe("Number of forecast days, 1-16"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ latitude, longitude, days }) => {
    let weather: ForecastResult;
    try {
      weather = await forecast(latitude, longitude, days);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`Weather lookup failed: ${message}`);
    }
    return toolText({ latitude, longitude, ...weather });
  }
);

/* -------------------------------------------------------------------------- */
/* Prompt                                                                     */
/* -------------------------------------------------------------------------- */

// Guides the agent to the convenience path first, with an explicit fallback
// to the manual geocode -> pick -> get_weather flow when disambiguation matters.
server.registerPrompt(
  "weather_briefing",
  {
    title: "Weather briefing for a place",
    description: "Guide the agent to resolve a place name and report its weather.",
    argsSchema: {
      place: z.string().describe("Place name, e.g. 'Frankfurt'"),
      days: z.string().describe("Forecast days, e.g. '3'"),
    },
  },
  ({ place, days }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Give a weather briefing for "${place}" covering the next ${days} day(s).`,
            "",
            "Steps:",
            "1. Call `get_weather_by_location` with the place name as given.",
            "2. If `alternativeMatches` > 0 and you're not confident the resolved " +
              "location is the one meant, use `geocode_location` to see all candidates, " +
              "pick the right one (asking the user if genuinely ambiguous), and call " +
              "`get_weather` with its coordinates instead.",
            "3. Summarize current conditions and the daily outlook in plain language, " +
              "naming the resolved location (city, country) you're reporting on.",
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
  console.error("weather-mcp-server running on stdio");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error starting weather-mcp-server:", err);
    process.exit(1);
  });
}
