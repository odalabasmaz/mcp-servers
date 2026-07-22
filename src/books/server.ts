#!/usr/bin/env node
/**
 * books-mcp-server
 * -----------------
 * An MCP server that exposes online book search via the OpenLibrary
 * `search.json` API (https://openlibrary.org/dev/docs/api/search).
 *
 * Scope note: OpenLibrary only indexes books/works/authors — it has no
 * weather or country/town data, so this server is a book search, not a
 * general-purpose search engine. If weather or geographic lookups are
 * needed later, they belong behind a separate tool backed by a different
 * API (e.g. Open-Meteo, REST Countries) — bolting unrelated domains onto
 * one tool's schema would make it harder for the model to use correctly.
 *
 * One read-only tool: `search_books`. Pagination (`limit` + `page`) is
 * passed straight through to OpenLibrary's own paging params.
 *
 * Transport is stdio, like the other servers in this repo.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json";
const REQUEST_TIMEOUT_MS = 8_000;

// Trim OpenLibrary's (large, deeply nested) doc down to what an agent
// actually needs — keeps tool output small and cheap to read.
const RESULT_FIELDS = [
  "key",
  "title",
  "author_name",
  "first_publish_year",
  "edition_count",
  "ebook_access",
  "cover_i",
  "language",
  "subject",
].join(",");

const server = new McpServer({
  name: "books-mcp-server",
  version: "1.0.0",
});

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface OpenLibraryDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  edition_count?: number;
  ebook_access?: string;
  cover_i?: number;
  language?: string[];
  subject?: string[];
}

interface OpenLibraryResponse {
  numFound: number;
  start: number;
  docs: OpenLibraryDoc[];
}

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

function coverUrl(coverId: number | undefined): string | undefined {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : undefined;
}

async function searchOpenLibrary(params: {
  q?: string;
  title?: string;
  author?: string;
  subject?: string;
  limit: number;
  page: number;
}): Promise<OpenLibraryResponse> {
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);
  if (params.q) url.searchParams.set("q", params.q);
  if (params.title) url.searchParams.set("title", params.title);
  if (params.author) url.searchParams.set("author", params.author);
  if (params.subject) url.searchParams.set("subject", params.subject);
  url.searchParams.set("limit", String(params.limit));
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("fields", RESULT_FIELDS);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "books-mcp-server/1.0 (contact: local)" },
    });
    if (!res.ok) {
      throw new Error(`OpenLibrary returned HTTP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as OpenLibraryResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/* -------------------------------------------------------------------------- */
/* Tools                                                                      */
/* -------------------------------------------------------------------------- */

server.registerTool(
  "search_books",
  {
    title: "Search books (OpenLibrary)",
    description:
      "Search books/works via the OpenLibrary catalog (openlibrary.org/search.json). " +
      "Read-only. At least one of `q`, `title`, `author`, `subject` is required. " +
      "Supports pagination via `limit` + `page`. Books only — OpenLibrary has no " +
      "weather or country/town data.",
    inputSchema: {
      q: z.string().min(1).optional().describe("General search query, e.g. 'dune'"),
      title: z.string().min(1).optional().describe("Restrict to this title"),
      author: z.string().min(1).optional().describe("Restrict to this author name"),
      subject: z.string().min(1).optional().describe("Restrict to this subject, e.g. 'science_fiction'"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .describe("Results per page, 1-100"),
      page: z.number().int().min(1).default(1).describe("1-based page number"),
    },
  },
  async ({ q, title, author, subject, limit, page }) => {
    if (!q && !title && !author && !subject) {
      return toolError("Provide at least one of: q, title, author, subject.");
    }

    let data: OpenLibraryResponse;
    try {
      data = await searchOpenLibrary({ q, title, author, subject, limit, page });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`OpenLibrary search failed: ${message}`);
    }

    const results = data.docs.map((d) => ({
      key: d.key,
      title: d.title,
      authors: d.author_name ?? [],
      firstPublishYear: d.first_publish_year,
      editionCount: d.edition_count,
      ebookAccess: d.ebook_access,
      languages: d.language ?? [],
      subjects: (d.subject ?? []).slice(0, 5),
      coverUrl: coverUrl(d.cover_i),
    }));

    return toolText({
      numFound: data.numFound,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(data.numFound / limit)),
      results,
    });
  }
);

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs MUST go to stderr — stdout is the MCP protocol channel.
  console.error("books-mcp-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting books-mcp-server:", err);
  process.exit(1);
});
