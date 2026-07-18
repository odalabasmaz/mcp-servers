#!/usr/bin/env node
/**
 * infra-mcp-server
 * -----------------
 * A minimal Model Context Protocol (MCP) server that exposes a few
 * IT-infrastructure operations to an LLM agent.
 *
 * It demonstrates the three MCP primitives:
 *   - Tools     : actions the agent can invoke   (echo, check_port)
 *   - Resources : read-only context the agent can pull in (system info)
 *   - Prompts   : reusable, parameterized prompt templates (diagnose_service)
 *
 * Transport is stdio, so any MCP client (Claude Desktop, the MCP Inspector,
 * an agent runtime) can spawn this process and talk to it over stdin/stdout.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import net from "node:net";
import os from "node:os";

const server = new McpServer({
  name: "infra-mcp-server",
  version: "1.0.0",
});

/* -------------------------------------------------------------------------- */
/* Tools                                                                      */
/* -------------------------------------------------------------------------- */

// The classic "hello world" — useful to confirm the wiring end-to-end.
server.registerTool(
  "echo",
  {
    title: "Echo",
    description: "Echo back a message. Handy smoke-test for the connection.",
    inputSchema: { message: z.string().describe("Text to echo back") },
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `echo: ${message}` }],
  })
);

// A real, safe infra tool: is a TCP port open on a host?
// Read-only, bounded by a timeout — the kind of low-risk probe an ops agent
// reaches for constantly (is the DB up? is the service listening?).
server.registerTool(
  "check_port",
  {
    title: "Check TCP Port",
    description:
      "Check whether a TCP port is open on a host. Read-only reachability probe.",
    inputSchema: {
      host: z.string().describe("Hostname or IP, e.g. 'localhost'"),
      port: z.number().int().min(1).max(65535).describe("TCP port, 1–65535"),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(10_000)
        .default(2000)
        .describe("Connection timeout in milliseconds"),
    },
  },
  async ({ host, port, timeoutMs }) => {
    const open = await isPortOpen(host, port, timeoutMs);
    return {
      content: [
        {
          type: "text",
          text: open
            ? `OPEN — ${host}:${port} is accepting connections.`
            : `CLOSED — ${host}:${port} is not reachable within ${timeoutMs}ms.`,
        },
      ],
    };
  }
);

/* -------------------------------------------------------------------------- */
/* Resources                                                                  */
/* -------------------------------------------------------------------------- */

// Read-only context the agent can pull in on demand, instead of us dumping
// everything into the prompt up front. Here: a snapshot of the host.
server.registerResource(
  "system-info",
  "system://info",
  {
    title: "System Info",
    description: "Snapshot of the host: OS, CPU, memory, uptime, load average.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(collectSystemInfo(), null, 2),
      },
    ],
  })
);

/* -------------------------------------------------------------------------- */
/* Prompts                                                                    */
/* -------------------------------------------------------------------------- */

// A reusable, parameterized prompt — captures a repeatable workflow so the
// agent (and the humans behind it) don't reinvent the diagnosis every time.
server.registerPrompt(
  "diagnose_service",
  {
    title: "Diagnose a service incident",
    description: "Generate a structured triage plan for a failing service.",
    argsSchema: {
      service: z.string().describe("Service name, e.g. 'payments-api'"),
      symptom: z.string().describe("Observed symptom, e.g. '5xx spike'"),
    },
  },
  ({ service, symptom }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `You are an SRE assistant. The service "${service}" is showing: ${symptom}.`,
            "",
            "Produce a triage plan:",
            "1. Most likely causes, ranked.",
            "2. Read-only checks to confirm each (use the available tools/resources).",
            "3. A safe remediation for the top cause, and what approval it needs.",
            "Prefer reversible, low-blast-radius actions first.",
          ].join("\n"),
        },
      },
    ],
  })
);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isPortOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

function collectSystemInfo() {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMB: Math.round(os.freemem() / 1024 / 1024),
    uptimeSec: Math.round(os.uptime()),
    loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))),
  };
}

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs MUST go to stderr — stdout is the MCP protocol channel.
  console.error("infra-mcp-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting infra-mcp-server:", err);
  process.exit(1);
});
