# infra-mcp-server

A minimal but complete **MCP (Model Context Protocol) server** in TypeScript,
themed around IT-infrastructure ops. It's small enough to read in one sitting,
but exercises all three MCP primitives an agent actually uses.

## What is MCP (in one paragraph)

MCP is a standard protocol that lets an LLM/agent talk to external systems
through a uniform interface. A **client** (Claude Desktop, the MCP Inspector, an
agent runtime) spawns or connects to a **server** that exposes capabilities. The
server speaks JSON-RPC over a transport — here, **stdio** (stdin/stdout).
Instead of hand-writing a bespoke integration per tool, you implement the MCP
contract once and any MCP-aware agent can use it.

## The three primitives (and why they differ)

| Primitive     | What it is                              | Who drives it | Example here        |
|---------------|-----------------------------------------|---------------|---------------------|
| **Tool**      | An action the agent can invoke          | Model         | `echo`, `check_port`|
| **Resource**  | Read-only context the agent pulls in    | App / model   | `system://info`     |
| **Prompt**    | A reusable, parameterized prompt template | User        | `diagnose_service`  |

The distinction matters for **safety and control** (a core concern for infra
agents): tools *do* things and may need approval; resources only *read*; prompts
standardize workflows so behavior is repeatable and reviewable.

## Contents

- **`echo`** *(tool)* — echoes a message. Smoke-test for the wiring.
- **`check_port`** *(tool)* — checks whether a TCP port is open on a host.
  Read-only, timeout-bounded — the kind of low-risk probe an ops agent runs
  constantly ("is the DB up? is the service listening?").
- **`system://info`** *(resource)* — JSON snapshot of the host (OS, CPU, memory,
  uptime, load).
- **`diagnose_service`** *(prompt)* — takes `service` + `symptom`, returns a
  structured triage plan that prefers reversible, low-blast-radius actions.

## Setup

Run from the **repo root** (dependencies and the build are shared across all servers):

```bash
npm install
npm run build
```

## Run it

```bash
# Compiled
npm run start:infra

# Or hot-reload during development
npm run dev:infra
```

The server communicates over stdio, so it prints nothing useful when run bare —
it waits for a client. Two ways to actually drive it:

### 1. MCP Inspector (interactive UI)

```bash
npm run inspect:infra
```

Opens a local UI to list/call tools, read resources, and render prompts.

### 2. Claude Desktop (or any MCP client)

Add to the client's MCP config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "infra": {
      "command": "node",
      "args": ["/absolute/path/to/dist/infra/server.js"]
    }
  }
}
```

ie.
```shell
claude mcp add infra --scope user -- node /Users/odalabasmaz/workspace/mcp-servers/dist/infra/server.js
```

Restart the client; the tools/resources/prompts appear automatically.

#### Verify and use it (Claude Code CLI)

```bash
claude mcp list          # shows "infra" and does a connection check
claude mcp get infra     # shows the resolved config
```

Then in a Claude Code session, `/mcp` lists the connected server and its
`echo` / `check_port` tools, the `system://info` resource, and the
`diagnose_service` prompt.

### 3. Raw JSON-RPC (quick sanity check)

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"c","version":"0"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check_port","arguments":{"host":"localhost","port":443}}}' \
| node dist/infra/server.js
```

## Design notes (the "why")

- **stdio transport** — zero network surface; the client owns the process
  lifecycle. Ideal for the on-prem / private-cloud, security-constrained
  deployments infra agents target. (HTTP/SSE transport is a config swap when you
  need remote access.)
- **Logs go to `stderr`** — `stdout` is the protocol channel; writing logs there
  corrupts JSON-RPC framing. A common first bug.
- **Inputs validated with Zod** — the schema is both runtime validation *and* the
  tool signature the model sees. External input is never trusted raw.
- **Tools are read-only here** — a mutating tool (restart a service, apply a
  fix) is where you'd wire in approvals, auditability, and blast-radius limits.

## Extending

Add a tool by calling `server.registerTool(name, { title, description,
inputSchema }, handler)`. Same shape for `registerResource` and
`registerPrompt`. Keep handlers small, validate inputs, return
`{ content: [...] }`.

## Layout

```
src/infra/server.ts   # the whole server: 2 tools, 1 resource, 1 prompt
src/infra/README.md   # this file
```

Shared across all servers, at the repo root: `tsconfig.json` (ES2022 + Node16
modules), `package.json` (per-server `build` / `start:*` / `dev:*` / `inspect:*`
scripts).
