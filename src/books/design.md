# books — Design (light template)

## 1. Requirements

- **Server name / domain**: `books`
- **What should the model be able to do or ask once this exists?**: Search
  for books/works/authors online and get back a trimmed, paginated result set.
- **Read-only, mutating, or both?**: Read-only only.
- **Core entity/entities and their key fields**: `Book result` — key, title,
  authors, firstPublishYear, editionCount, ebookAccess, languages, subjects,
  coverUrl.
- **Backend**: Free/keyless public API — OpenLibrary `search.json`.
- **Anything explicitly out of scope for this pass?**: Weather and
  country/town lookups (a prior ask assumed one search server could cover
  all of these — OpenLibrary is books-only, so that needs separate backends).

## 2. Tools

| Tool name | Purpose | Read-only / Mutating | Key inputs |
|---|---|---|---|
| `search_books` | Search OpenLibrary by `q`/`title`/`author`/`subject`, paginated | Read-only | `q?`, `title?`, `author?`, `subject?`, `limit`, `page` (at least one query field required) |

## 3. Resources

_(N/A — none needed; a single parameterized search tool covers the use case.)_

## 4. Prompts

_(N/A — one tool, no multi-step workflow to chain.)_
