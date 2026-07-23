# oncall — Design (light template)

## 1. Requirements

- **Server name / domain**: `oncall`
- **What should the model be able to do or ask once this exists?**: Track
  incidents through their lifecycle (open → acked → resolved), see who owns
  what, and query active/past incidents by status, severity, or owner.
- **Read-only, mutating, or both?**: Both — list/get are read-only;
  open/ack/resolve are mutating and state-transition-gated (invalid
  transitions, e.g. resolving an already-resolved incident, must be rejected).
- **Core entity/entities and their key fields**: `Incident` — id, title,
  description, details, affectedServices (list), severity
  (`low`/`medium`/`high`/`critical`), ownerTeam, assignee, status
  (`open`/`acked`/`resolved`), createdAt, ackedAt, resolvedAt.
- **Backend**: In-memory mock (no real PagerDuty/Opsgenie integration for
  this pass — a code exercise, not a production integration).
- **Anything explicitly out of scope for this pass?**: Real auth/RBAC (single
  implicit "engineer" role, no permission checks), postmortem generation,
  paging/notification delivery — state tracking only.

## 2. Tools

| Tool name | Purpose | Read-only / Mutating | Key inputs |
|---|---|---|---|
| `open_incident` | Create a new incident in `open` status | Mutating | `title`, `description`, `affectedServices`, `severity`, `ownerTeam`, `idempotencyKey?` |
| `ack_incident` | Acknowledge an open incident, assign an owner | Mutating | `id`, `assignee` |
| `resolve_incident` | Mark an acked incident as resolved | Mutating | `id`, `resolutionNotes?` |
| `list_incidents` | List incidents, filterable | Read-only | `status?`, `severity?`, `assignee?` |
| `get_incident` | Full detail for one incident | Read-only | `id` |

## 3. Resources

| Resource URI pattern | Returns |
|---|---|
| `incident://{id}` | Same shape as `get_incident`, exposed as a stable-ID resource for direct reference |

_(Optional — `get_incident` tool alone is sufficient for v1; add the resource
only if the client benefits from referencing an incident by URI outside a
tool call.)_

## 4. Prompts

| Prompt name | Steps (in order) |
|---|---|
| `triage_flow` | `list_incidents` (status=`open`) → `get_incident` for context → `ack_incident` (assign self/team) → work the issue → `resolve_incident` with notes |
