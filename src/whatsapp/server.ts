#!/usr/bin/env node
/**
 * whatsapp-mcp-server
 * --------------------
 * An MCP server that lets an agent read and reply to your **personal**
 * WhatsApp account, via the unofficial `whatsapp-web.js` library (drives a
 * real headless WhatsApp Web session through Puppeteer/Chromium).
 *
 * IMPORTANT — read before using:
 *   - This is NOT the official WhatsApp Business API. It automates the same
 *     web client you'd use at web.whatsapp.com, which is against WhatsApp's
 *     Terms of Service. Real risk: your number can be flagged or banned,
 *     especially under heavy/bursty automated use. Use at your own risk, on
 *     an account you're prepared to lose access to.
 *   - Pairing is a one-time, separate step (`npm run whatsapp:pair`) that
 *     shows a QR code in your terminal to scan from your phone (WhatsApp →
 *     Settings → Linked devices → Link a device) — same reasoning as the
 *     calendar server's Google OAuth helper: an interactive auth step
 *     doesn't belong inside a headless stdio MCP server, so it's a separate
 *     script that persists reusable session state to disk.
 *   - Requires a real Chromium binary for Puppeteer. If `npm install`
 *     couldn't download one (e.g. blocked in a sandboxed environment), see
 *     README.md "Chromium" for how to supply one.
 *
 * Read/write both go straight through whatsapp-web.js's own client-side
 * state (`getChats()`, `chat.fetchMessages()`) — no separate in-memory
 * store to maintain here, unlike a protocol-level library.
 *
 * Transport is stdio, like the other servers in this repo.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import os from "node:os";
import path from "node:path";
import type { Chat, Message } from "whatsapp-web.js";
// whatsapp-web.js is CommonJS; Node's ESM loader can't statically see its
// named exports, so it must come in via the default import and be destructured.
import whatsappWebPkg from "whatsapp-web.js";
const { Client, LocalAuth } = whatsappWebPkg;

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR ?? path.join(os.homedir(), ".whatsapp-mcp-server", "auth");

function toolError(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function toolText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

type ConnectionState = "connecting" | "ready" | "disconnected";
let connectionState: ConnectionState = "connecting";
let ownNumber: string | undefined;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
  puppeteer: { headless: true },
});

function requireReady(): string | undefined {
  if (connectionState === "ready") return undefined;
  if (connectionState === "connecting") {
    return "WhatsApp client is still connecting — wait a moment and retry.";
  }
  return "WhatsApp client is disconnected (e.g. logged out from your phone). " +
    "Re-run `npm run whatsapp:pair` to reconnect.";
}

function summarizeChat(chat: Chat) {
  return {
    chatId: chat.id._serialized,
    name: chat.name,
    isGroup: chat.isGroup,
    unreadCount: chat.unreadCount,
    lastMessage: chat.lastMessage
      ? { body: chat.lastMessage.body, fromMe: chat.lastMessage.fromMe, timestamp: chat.lastMessage.timestamp }
      : undefined,
    lastActivity: chat.timestamp,
  };
}

function summarizeMessage(message: Message) {
  return {
    id: message.id._serialized,
    chatId: message.fromMe ? message.to : message.from,
    fromMe: message.fromMe,
    author: message.author, // set only for group messages; sender within the group
    body: message.hasMedia && !message.body ? `[${message.type}]` : message.body,
    type: message.type,
    timestamp: message.timestamp,
  };
}

/* -------------------------------------------------------------------------- */
/* MCP server                                                                 */
/* -------------------------------------------------------------------------- */

export const server = new McpServer({
  name: "whatsapp-mcp-server",
  version: "1.0.0",
});

server.registerTool(
  "whatsapp_status",
  {
    title: "WhatsApp connection status",
    description: "Check whether the WhatsApp session is connected and ready to use. Read-only.",
    inputSchema: {},
  },
  async () => {
    return toolText({ connectionState, ownNumber });
  }
);

server.registerTool(
  "list_chats",
  {
    title: "List WhatsApp chats",
    description:
      "List your WhatsApp chats (individual + group), most recently active first. Read-only. " +
      "Use a returned `chatId` with `get_messages` or `send_message`.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20).describe("Max chats to return"),
      unreadOnly: z.boolean().default(false).describe("Only include chats with unread messages"),
    },
  },
  async ({ limit, unreadOnly }) => {
    const notReady = requireReady();
    if (notReady) return toolError(notReady);

    let chats: Chat[];
    try {
      chats = await client.getChats();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`Failed to list chats: ${message}`);
    }

    const filtered = unreadOnly ? chats.filter((c) => c.unreadCount > 0) : chats;
    const sorted = filtered.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
    return toolText({ count: sorted.length, chats: sorted.map(summarizeChat) });
  }
);

server.registerTool(
  "get_messages",
  {
    title: "Get messages in a chat",
    description:
      "Fetch recent messages from a chat by `chatId` (from `list_chats`). Read-only. " +
      "Non-text messages show as e.g. '[image]' — media content itself isn't returned.",
    inputSchema: {
      chatId: z.string().min(1).describe("Chat id, e.g. '491701234567@c.us' or a group id ending '@g.us'"),
      limit: z.number().int().min(1).max(100).default(20).describe("Max messages to return"),
    },
  },
  async ({ chatId, limit }) => {
    const notReady = requireReady();
    if (notReady) return toolError(notReady);

    try {
      const chat = await client.getChatById(chatId);
      const messages = await chat.fetchMessages({ limit });
      return toolText({ chatId, count: messages.length, messages: messages.map(summarizeMessage) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`Failed to fetch messages for '${chatId}': ${message}`);
    }
  }
);

server.registerTool(
  "send_message",
  {
    title: "Send a WhatsApp message",
    description:
      "Send a text message. `to` can be a phone number (digits, with country code, e.g. '491701234567') " +
      "or an existing chatId (e.g. '491701234567@c.us' / a group's '...@g.us'). Sends immediately — " +
      "this is irreversible for the recipient (WhatsApp allows deleting your own sent message afterwards, " +
      "but that's a separate action, not undone by this tool).",
    inputSchema: {
      to: z.string().min(1).describe("Phone number or chatId to send to"),
      text: z.string().min(1).describe("Message text"),
    },
  },
  async ({ to, text }) => {
    const notReady = requireReady();
    if (notReady) return toolError(notReady);

    const looksLikeChatId = to.endsWith("@c.us") || to.endsWith("@g.us");
    let chatId = to;
    if (!looksLikeChatId) {
      const digits = to.replace(/[^\d]/g, "");
      let numberId;
      try {
        numberId = await client.getNumberId(digits);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return toolError(`Failed to look up '${to}' on WhatsApp: ${message}`);
      }
      if (!numberId) {
        return toolError(`'${to}' is not a registered WhatsApp number.`);
      }
      chatId = numberId._serialized;
    }

    try {
      const sent = await client.sendMessage(chatId, text);
      return toolText({ status: "sent", chatId, message: summarizeMessage(sent) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`Failed to send message to '${to}': ${message}`);
    }
  }
);

/* -------------------------------------------------------------------------- */
/* Prompt                                                                     */
/* -------------------------------------------------------------------------- */

// Chains the tools into the repeatable "check messages, then reply" workflow.
server.registerPrompt(
  "reply_flow",
  {
    title: "Check and reply to WhatsApp messages",
    description: "Guide the agent to review recent chats and draft/send a reply.",
    argsSchema: {
      focus: z.string().describe("Who or what to focus on, e.g. 'unread chats' or 'messages from Jane'"),
    },
  },
  ({ focus }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Check WhatsApp for: ${focus}.`,
            "",
            "Steps:",
            "1. Call `list_chats` (use `unreadOnly: true` if focusing on unread).",
            "2. For the relevant chat(s), call `get_messages` to see recent context.",
            "3. Draft a reply and show it to me before sending, unless I've already told you what to say.",
            "4. Only call `send_message` after I've approved the exact text — sending is immediate and " +
              "visible to the recipient; don't send speculatively.",
          ].join("\n"),
        },
      },
    ],
  })
);

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

async function main() {
  client.on("qr", () => {
    // A QR event here means no valid paired session exists. Pairing is
    // interactive and belongs in the separate `whatsapp:pair` script, not in
    // this headless stdio server — fail fast with a clear pointer instead of
    // trying to render a QR code through the MCP transport.
    console.error(
      "No paired WhatsApp session found in " + AUTH_DIR + ". Run `npm run whatsapp:pair` first, then restart this server."
    );
    process.exit(1);
  });

  client.on("ready", () => {
    connectionState = "ready";
    ownNumber = client.info?.wid?.user;
    console.error(`whatsapp-mcp-server: WhatsApp client ready (${ownNumber ?? "unknown number"})`);
  });

  client.on("disconnected", (reason) => {
    connectionState = "disconnected";
    console.error(`whatsapp-mcp-server: WhatsApp client disconnected (${reason})`);
  });

  client.on("auth_failure", (message) => {
    console.error(`whatsapp-mcp-server: authentication failed: ${message}`);
  });

  await client.initialize();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs MUST go to stderr — stdout is the MCP protocol channel.
  console.error("whatsapp-mcp-server running on stdio");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error starting whatsapp-mcp-server:", err);
    process.exit(1);
  });
}
