#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { InMemoryOnCallBackend, type OnCallBackend } from "./backend.js";

const server = new McpServer({ name: "oncall-mcp-server", version: "1.0.0" });

const severityEnum = z.enum(["low", "medium", "high", "critical"]);
const statusEnum = z.enum(["open", "acked", "resolved"]);

function toolError(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}
function toolText(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

export function registerTools(server: McpServer, backend: OnCallBackend) {
  server.registerTool(
    "open_incident",
    {
      title: "Open incident",
      description:
        "Create a new incident in 'open' status. Mutating. Pass idempotencyKey so a retried " +
        "call returns the existing incident instead of creating a duplicate.",
      inputSchema: {
        title: z.string().min(1).describe("Short incident title"),
        description: z.string().min(1).describe("What's happening"),
        details: z.string().optional().describe("Extra context: logs, timeline, links"),
        affectedServices: z.array(z.string()).min(1).describe("Service names impacted"),
        severity: severityEnum.describe("Incident severity"),
        ownerTeam: z.string().min(1).describe("Team responsible for this incident"),
        idempotencyKey: z
          .string()
          .optional()
          .describe("Stable key; a retried call with the same key returns the original incident"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      if (input.idempotencyKey) {
        const existing = backend.findByIdempotencyKey(input.idempotencyKey);
        if (existing) return toolText(existing);
      }
      const incident = backend.create(input);
      return toolText(incident);
    },
  );

  server.registerTool(
    "ack_incident",
    {
      title: "Acknowledge incident",
      description:
        "Acknowledge an open incident and assign an owner. Mutating. Idempotent if the same " +
        "assignee re-acks; reassigning to a different assignee requires force:true.",
      inputSchema: {
        id: z.string().min(1).describe("Incident id, e.g. INC-1"),
        assignee: z.string().min(1).describe("Who is taking ownership"),
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe("Required to reassign an already-acked incident to a different assignee"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, assignee, force }) => {
      const incident = backend.get(id);
      if (!incident) return toolError(`No incident with id ${id}`);

      if (incident.status === "resolved") {
        return toolError(`Incident ${id} is already resolved; cannot ack a resolved incident.`);
      }

      if (incident.status === "acked") {
        if (incident.assignee === assignee) {
          return toolText({ ...incident, note: "already acked by this assignee (idempotent no-op)" });
        }
        if (!force) {
          return toolError(
            `Incident ${id} is already acked by ${incident.assignee}. Pass force:true to reassign to ${assignee}.`,
          );
        }
      }

      incident.status = "acked";
      incident.assignee = assignee;
      incident.ackedAt = new Date().toISOString();
      backend.save(incident);
      return toolText(incident);
    },
  );

  server.registerTool(
    "resolve_incident",
    {
      title: "Resolve incident",
      description:
        "Mark an acked incident as resolved. Mutating. Idempotent if already resolved; " +
        "resolving directly from 'open' (skipping ack) requires force:true.",
      inputSchema: {
        id: z.string().min(1).describe("Incident id, e.g. INC-1"),
        resolutionNotes: z.string().optional().describe("What fixed it"),
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe("Required to resolve an incident that hasn't been acked yet"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, resolutionNotes, force }) => {
      const incident = backend.get(id);
      if (!incident) return toolError(`No incident with id ${id}`);

      if (incident.status === "resolved") {
        return toolText({ ...incident, note: "already resolved (idempotent no-op)" });
      }

      if (incident.status === "open" && !force) {
        return toolError(
          `Incident ${id} has not been acked yet. Ack it first, or pass force:true to resolve directly.`,
        );
      }

      incident.status = "resolved";
      incident.resolvedAt = new Date().toISOString();
      if (resolutionNotes) incident.resolutionNotes = resolutionNotes;
      backend.save(incident);
      return toolText(incident);
    },
  );

  server.registerTool(
    "list_incidents",
    {
      title: "List incidents",
      description: "List incidents, optionally filtered by status, severity, or assignee. Read-only.",
      inputSchema: {
        status: statusEnum.optional().describe("Filter by status"),
        severity: severityEnum.optional().describe("Filter by severity"),
        assignee: z.string().optional().describe("Filter by assignee"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ status, severity, assignee }) => {
      const incidents = backend.list({ status, severity, assignee });
      return toolText({ count: incidents.length, incidents });
    },
  );

  server.registerTool(
    "get_incident",
    {
      title: "Get incident",
      description: "Full detail for one incident by id. Read-only.",
      inputSchema: {
        id: z.string().min(1).describe("Incident id, e.g. INC-1"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      const incident = backend.get(id);
      if (!incident) return toolError(`No incident with id ${id}`);
      return toolText(incident);
    },
  );

  server.registerPrompt(
    "triage_flow",
    {
      title: "Incident triage flow",
      description: "Guides working an open incident from triage to resolution.",
      argsSchema: {},
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Triage open incidents:\n" +
              "1. Call list_incidents with status: 'open' to see what needs attention.\n" +
              "2. Call get_incident for full context on the one you're handling.\n" +
              "3. Call ack_incident with your assignee name to take ownership.\n" +
              "4. Investigate and fix the issue.\n" +
              "5. Call resolve_incident with resolutionNotes describing the fix.\n" +
              "Do NOT force an ack/resolve transition without explicit user approval.",
          },
        },
      ],
    }),
  );
}

registerTools(server, new InMemoryOnCallBackend());

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("oncall-mcp-server running on stdio");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error starting oncall-mcp-server:", err);
    process.exit(1);
  });
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
}
