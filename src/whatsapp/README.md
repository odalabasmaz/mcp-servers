# whatsapp-mcp-server

An MCP server that lets an agent read and reply to your **personal**
WhatsApp account, via the unofficial [`whatsapp-web.js`](https://wwebjs.dev/)
library.

---

## Read this before using it

This automates the same web client at web.whatsapp.com (via a real headless
Chromium browser), **not** the official WhatsApp Business API. That means:

- **It's against WhatsApp's Terms of Service.** There is no sanctioned way
  to automate a personal account this way.
- **Real ban risk.** WhatsApp can flag or ban a number for automated/bot-like
  behavior, especially bursty sending. Use an account you're prepared to
  lose access to — not your only phone number.
- Prefer the [official WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp)
  if you need something ToS-compliant, though it requires a Business
  account, a separate WhatsApp Business number, and pre-approved message
  templates for anything outside a 24h customer-reply window — a very
  different setup from "read/reply on my existing personal chats."

If you're fine with that trade-off (this repo's other servers are all
zero-risk by comparison — read that as a deliberate signal, not a formality),
here's how it works.

## What it exposes

| Name | Kind | Purpose |
|------|------|---------|
| `whatsapp_status` | tool (read) | Connection state (`connecting`/`ready`/`disconnected`) + your own number |
| `list_chats` | tool (read) | Your chats, most recently active first; optional `unreadOnly` filter |
| `get_messages` | tool (read) | Recent messages in a chat (by `chatId` from `list_chats`) |
| `send_message` | tool (write) | Send a text message, by phone number or `chatId` |
| `reply_flow` | prompt | Guides: check chats → read context → draft → confirm → send |

Unlike `calendar`'s pluggable-backend design, there's no in-memory demo mode
here — a fake WhatsApp session isn't a meaningful thing to simulate, so this
server always talks to a real (paired) WhatsApp Web session.

`send_message` is a **write** tool that sends immediately and visibly to the
recipient — there's no conflict-gate or approval step built into the tool
itself (unlike `calendar`'s `schedule_interview`, there's no equivalent
concept of "conflict" to check first). The `reply_flow` prompt explicitly
tells the agent to show you the drafted reply and wait for your go-ahead
before calling `send_message` — but that's a prompt-level convention, not a
tool-level guarantee. Whatever MCP client you use (e.g. Claude Code) also
gates tool calls through its own permission system, which is your actual
safety net against an unapproved send.

## Setup

### 1. Install dependencies (repo root)

```bash
npm install
npm run build
```

### 2. Chromium

`whatsapp-web.js` drives a real Chromium via Puppeteer, which normally
downloads its own Chromium binary during `npm install`. If that download was
blocked (e.g. a sandboxed environment with install scripts disabled), do it
manually once:

```bash
npx puppeteer browsers install chrome
```

This was required and verified working when this server was built — `npm
install` alone did not fetch Chromium in that environment, but the command
above did.

### 3. Pair your WhatsApp account (one-time)

```bash
npm run whatsapp:pair
```

This prints a QR code to your terminal. On your phone: **WhatsApp → Settings
→ Linked devices → Link a device**, then scan it. On success, it prints your
number and exits. The session is saved to
`~/.whatsapp-mcp-server/auth` (override with `WHATSAPP_AUTH_DIR`) so you
don't need to re-pair on every restart — only if you unlink the device from
your phone or the session otherwise expires.

Pairing is a separate script, not something the main server does
interactively — the server runs headless under an MCP client over stdio, the
same reasoning as the calendar server's Google OAuth helper
(`google:auth`): an interactive auth step doesn't belong inside a headless
process, and stdout is reserved for the MCP protocol anyway.

### 4. Register with an MCP client (e.g. Claude Code)

```bash
claude mcp add whatsapp --scope user -- \
  node /Users/odalabasmaz/workspace/mcp-servers/dist/whatsapp/server.js
```

If you used a custom `WHATSAPP_AUTH_DIR` for pairing, pass it here too:

```bash
claude mcp add whatsapp --scope user \
  -e WHATSAPP_AUTH_DIR=/custom/path \
  -- node /Users/odalabasmaz/workspace/mcp-servers/dist/whatsapp/server.js
```

If no paired session is found at startup, the server fails fast with a
clear message (`No paired WhatsApp session found ... Run npm run
whatsapp:pair first`) rather than trying to show a QR code through the MCP
transport, which wouldn't render usefully there anyway.

### Interactive UI (MCP Inspector)

```bash
npm run inspect:whatsapp
```

Note: unlike the other servers here, the first `whatsapp_status` call may
report `connecting` for a few seconds after startup while the headless
browser session reconnects — that's expected, not a bug; poll again or wait
for `ready`.

## Design notes

- **No custom message store** — `list_chats`/`get_messages` read straight
  from `whatsapp-web.js`'s own client-side state (`getChats()`,
  `chat.fetchMessages()`), which mirrors what you'd see in WhatsApp Web
  itself. No separate buffering/store code needed, unlike a protocol-level
  library that only sees messages that arrive while it's running.
- **CommonJS interop gotcha** — `whatsapp-web.js` is CJS and doesn't expose
  named exports Node's ESM loader can statically see; runtime imports use
  `import pkg from "whatsapp-web.js"; const { Client, LocalAuth } = pkg;`
  (type-only imports like `import type { Chat } from "..."` are unaffected —
  they're erased at compile time).
- **Structured errors** — a failed send (e.g. number not on WhatsApp,
  connection not ready) comes back as `isError: true`, not a thrown
  exception.
- **Auth state lives outside the repo** by default (`~/.whatsapp-mcp-server`)
  so session credentials are never at risk of being committed;
  `.wwebjs_auth/`/`.wwebjs_cache/`/`.whatsapp-auth/` are gitignored anyway as
  a backstop if you point `WHATSAPP_AUTH_DIR` somewhere inside the repo.

## Layout

```
src/whatsapp/server.ts           # tools, prompt, connection lifecycle
src/whatsapp/scripts/pair.ts     # one-time QR pairing (npm run whatsapp:pair)
src/whatsapp/README.md           # this file
```
