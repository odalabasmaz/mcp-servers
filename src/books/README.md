# books-mcp-server

An MCP server that gives an agent online **book search** via the
[OpenLibrary Search API](https://openlibrary.org/dev/docs/api/search)
(`openlibrary.org/search.json`).

---

## What is it

A single read-only tool, `search_books`, that queries OpenLibrary's catalog
and returns a trimmed, paginated result set.

> **Scope note:** OpenLibrary only indexes books, works, and authors — it has
> no weather or country/town data. This server is a book search, not a
> general-purpose search engine. Weather or geographic lookups would need a
> different backend (e.g. Open-Meteo, REST Countries) behind their own tool.

### What it exposes

| Name | Kind | Purpose |
|------|------|---------|
| `search_books` | tool (read) | Search OpenLibrary by `q` / `title` / `author` / `subject`, paginated via `limit` + `page` |

**Inputs**

- `q`, `title`, `author`, `subject` — at least one required.
- `limit` — results per page, 1–100, default 10.
- `page` — 1-based page number, default 1.

**Output** (`content[0].text`, JSON):

```json
{
  "numFound": 45037,
  "page": 1,
  "limit": 5,
  "totalPages": 9008,
  "results": [
    {
      "key": "/works/OL893415W",
      "title": "Dune",
      "authors": ["Frank Herbert"],
      "firstPublishYear": 1965,
      "editionCount": 120,
      "ebookAccess": "borrowable",
      "languages": ["eng", "spa"],
      "subjects": ["Science fiction", "..."],
      "coverUrl": "https://covers.openlibrary.org/b/id/11481354-M.jpg"
    }
  ]
}
```

Only a subset of OpenLibrary's fields is requested (via the `fields=` query
param) and reshaped — the raw docs are large and deeply nested, which is
wasted context for a model.

---

## How to use

Run from the **repo root** (build is shared across all servers):

```bash
npm install
npm run build
```

### Interactive UI (MCP Inspector)

```bash
npm run inspect:books
```

### Register with an MCP client (e.g. Claude Code)

```bash
claude mcp add books --scope user -- \
  node /Users/odalabasmaz/workspace/mcp-servers/dist/books/server.js
```

### Quick sanity check (raw JSON-RPC)

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"c","version":"0"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_books","arguments":{"q":"dune","limit":3,"page":1}}}' \
| node dist/books/server.js
```

### Example prompts (Claude Code CLI)

Once registered (`claude mcp add books ...`), just ask in plain language:

- "Search for books about dune"
- "Find books by Frank Herbert"
- "Show me the second page of results for 'science fiction' subject, 5 per page"
- "Look up the book 'Project Hail Mary'"

## Design notes

- **Read-only, no auth** — OpenLibrary's search endpoint is public; no API
  key or secret handling needed.
- **Timeout-bounded** (8s) via `AbortController` — a hung upstream call
  can't hang the tool call indefinitely.
- **Structured errors** — a non-2xx response or network failure comes back
  as `isError: true` with a message, not a thrown exception.
- **Pagination passthrough** — `limit`/`page` map 1:1 to OpenLibrary's own
  paging params, so behavior (and `numFound`) matches the upstream API
  directly.

## Layout

```
src/books/server.ts   # the whole server: 1 tool
src/books/README.md   # this file
```
