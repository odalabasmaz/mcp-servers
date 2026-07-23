# weather — Design (light template)

## 1. Requirements

- **Server name / domain**: `weather`
- **What should the model be able to do or ask once this exists?**: Get
  current conditions + a daily forecast for a place, by name (no coordinates
  needed), with a manual disambiguation path for ambiguous place names.
- **Read-only, mutating, or both?**: Read-only only.
- **Core entity/entities and their key fields**: `Location` (name, country,
  admin1, latitude, longitude), `Forecast` (current + daily conditions).
- **Backend**: Free/keyless public API — Open-Meteo geocoding + forecast.
- **Anything explicitly out of scope for this pass?**: Weather alerts/warnings,
  historical weather — current + forward-looking forecast only.

## 2. Tools

| Tool name | Purpose | Read-only / Mutating | Key inputs |
|---|---|---|---|
| `get_weather_by_location` | **Default.** Place name → weather at best-ranked match, one call | Read-only | `location`, `days` |
| `geocode_location` | Place name → all candidate lat/lon matches | Read-only | `query`, `count` |
| `get_weather` | Lat/lon → current + daily forecast | Read-only | `latitude`, `longitude`, `days` |

## 3. Resources

_(N/A — no resources; weather is inherently a parameterized query, not a
stable-ID lookup.)_

## 4. Prompts

| Prompt name | Steps (in order) |
|---|---|
| `weather_briefing` | Try `get_weather_by_location` first → if `alternativeMatches > 0` and result looks wrong, fall back to `geocode_location` → pick the right candidate → `get_weather` |
