# infra — Design (light template)

## 1. Requirements

- **Server name / domain**: `infra`
- **What should the model be able to do or ask once this exists?**: Run
  low-risk IT-infra ops checks (echo/connectivity smoke test, is a TCP port
  open on a host) and pull a system-info snapshot for triage.
- **Read-only, mutating, or both?**: Read-only only.
- **Core entity/entities and their key fields**: No stored entities — stateless
  probes against the live host/network.
- **Backend**: In-memory / local host only (no external API, no auth).
- **Anything explicitly out of scope for this pass?**: Any mutating action
  (restarting a service, applying a fix) — deliberately left out; would need
  approval/auditability wiring first.

## 2. Tools

| Tool name | Purpose | Read-only / Mutating | Key inputs |
|---|---|---|---|
| `echo` | Echoes a message back — wiring smoke test | Read-only | `message` |
| `check_port` | Checks whether a TCP port is open on a host | Read-only | `host`, `port` |

## 3. Resources

| Resource URI pattern | Returns |
|---|---|
| `system://info` | JSON snapshot of the host: OS, CPU, memory, uptime, load |

## 4. Prompts

| Prompt name | Steps (in order) |
|---|---|
| `diagnose_service` | Takes `service` + `symptom` → returns a structured triage plan that prefers reversible, low-blast-radius actions first |
