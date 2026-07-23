# weather-mcp-server

An MCP server that gives an agent weather lookups via the free, keyless
[Open-Meteo](https://open-meteo.com/) geocoding + forecast APIs.

---

## What is it

Weather lookups by **place name** — no coordinates required. The default
path is one call: give a location string, get current conditions + a daily
forecast. Two lower-level tools stay available for the cases where you need
to see and choose between multiple same-named places yourself, rather than
trust the server's best guess.

### What it exposes

| Name | Kind | Purpose |
|------|------|---------|
| `get_weather_by_location` | tool (read) | **Default.** Place name -> weather at the best-ranked match, in one call |
| `geocode_location` | tool (read) | Place name -> ALL candidate lat/lon matches, for manual disambiguation |
| `get_weather` | tool (read) | Lat/lon -> current conditions + daily forecast |
| `weather_briefing` | prompt | Guides: try `get_weather_by_location` first, fall back to geocode+pick+get_weather if ambiguous |

**`get_weather_by_location` inputs:** `location` (required, e.g. `"Munich"`
or `"Munich, Germany"`), `days` (1-16, default 3).

**`geocode_location` inputs:** `query` (required), `count` (1-20, default 5).

**`get_weather` inputs:** `latitude`, `longitude` (required), `days` (1-16,
default 3).

**Output** (`content[0].text`, JSON), `get_weather_by_location`:

```json
{
  "resolvedLocation": { "name": "Munich", "country": "Germany", "admin1": "Bavaria", "latitude": 48.13743, "longitude": 11.57549 },
  "alternativeMatches": 4,
  "current": {
    "time": "2026-07-19T18:30",
    "temperatureC": 20.5,
    "humidityPct": 43,
    "windSpeedKmh": 9.7,
    "condition": "Mainly clear"
  },
  "daily": [
    { "date": "2026-07-19", "minTempC": 16.7, "maxTempC": 21.9, "precipitationMm": 0.1, "condition": "Mainly clear" }
  ]
}
```

`alternativeMatches` is how many other geocoding candidates existed besides
the one used — `0` for a qualified query like `"Munich, Germany"`, `> 0` for
a bare name like `"Munich"` (which still resolved correctly here — Open-Meteo
ranks by population — but flags that it was a guess). If the resolved
location looks wrong and `alternativeMatches > 0`, use `geocode_location` to
see every candidate and `get_weather` with the right one's coordinates.

WMO weather codes are translated to short text (`condition`) so the model
doesn't need to know the code table.

---

## How to use

Run from the **repo root** (build is shared across all servers):

```bash
npm install
npm run build
```

### Interactive UI (MCP Inspector)

```bash
npm run inspect:weather
```

### Register with an MCP client (e.g. Claude Code)

```bash
claude mcp add weather --scope user -- \
  node /Users/odalabasmaz/workspace/mcp-servers/dist/weather/server.js
```

### Quick sanity check (raw JSON-RPC)

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"c","version":"0"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_weather_by_location","arguments":{"location":"Munich, Germany","days":2}}}' \
| node dist/weather/server.js
```

### Example prompts (Claude Code CLI)

Once registered (`claude mcp add weather ...`), just ask in plain language:

- "What's the weather in Munich?"
- "Give me a 5-day forecast for Tokyo"
- "Is it going to rain in Berlin tomorrow?"
- "There are multiple places called Springfield — show me all the geocoding matches"
- "Use the weather_briefing prompt for Paris, France"

## Design notes

- **No API key** — Open-Meteo's free tier needs no auth, so this server is
  zero-config like `books` and the in-memory `calendar` default.
- **Timeout-bounded** (8s) via `AbortController`.
- **Structured errors** — a non-2xx response, unresolvable location, or
  network failure comes back as `isError: true`, not a thrown exception.
- **Convenience tool + escape hatch, not one or the other** —
  `get_weather_by_location` covers the common case in one call; the
  underlying `geocode_location` + `get_weather` stay exposed (and are what
  `get_weather_by_location` is built on internally) for when a bare place
  name is genuinely ambiguous and picking wrong would matter.

## Layout

```
src/weather/server.ts   # the whole server: 3 tools, 1 prompt
src/weather/README.md   # this file
```
