# MCP Server Design Template (Light)

Quick version for small/time-boxed builds (e.g. interview exercises). Answer
inline, keep it short. For a full requirements pass (backend/auth details,
idempotency, resilience, etc.), use
[`mcp-server-design-template.md`](mcp-server-design-template.md) instead.

---

## 1. Requirements

- **Server name / domain**: _(answer)_
- **What should the model be able to do or ask once this exists?**: _(answer)_
- **Read-only, mutating, or both?**: _(answer)_
- **Core entity/entities and their key fields**: _(answer)_
- **Backend**: in-memory mock / free API / API key / OAuth? _(answer)_
- **Anything explicitly out of scope for this pass?**: _(answer)_

## 2. Tools

| Tool name | Purpose | Read-only / Mutating | Key inputs |
|---|---|---|---|
| | | | |
| | | | |

## 3. Resources

Pure data lookups by stable ID/URI (no side effects, no extra params beyond
an identifier) — otherwise it's a tool, not a resource.

| Resource URI pattern | Returns |
|---|---|
| | |

_(N/A if none needed)_

## 4. Prompts

Named multi-tool workflows worth documenting as a sequence (e.g. "check →
then act").

| Prompt name | Steps (in order) |
|---|---|
| | |

_(N/A if none needed)_

---

## Handoff

Hand this filled-in file to the `mcp-builder` skill as the resolved spec.
