# whatsapp — Design (light template)

## 1. Requirements

- **Server name / domain**: `whatsapp`
- **What should the model be able to do or ask once this exists?**: Read the
  user's personal WhatsApp chats/messages and send a reply, via a real paired
  WhatsApp Web session.
- **Read-only, mutating, or both?**: Both — 3 read tools, 1 mutating tool
  (`send_message`, no conflict concept applies).
- **Core entity/entities and their key fields**: `Chat` (chatId, name,
  lastActivity, unread), `Message` (from, body, timestamp).
- **Backend**: Real external system via unofficial `whatsapp-web.js` client
  (headless Chromium), authenticated via one-time QR pairing — no in-memory
  demo mode (a fake session isn't meaningful to simulate). ⚠️ Against
  WhatsApp's ToS — real ban risk, deliberate trade-off documented in the
  server's README.
- **Anything explicitly out of scope for this pass?**: Media messages
  (images/audio/documents), group-chat management — text messages in
  existing chats only.

## 2. Tools

| Tool name | Purpose | Read-only / Mutating | Key inputs |
|---|---|---|---|
| `whatsapp_status` | Connection state + own number | Read-only | _(none)_ |
| `list_chats` | Chats, most recently active first | Read-only | `unreadOnly?` |
| `get_messages` | Recent messages in a chat | Read-only | `chatId` |
| `send_message` | Send a text message | Mutating | `to` (phone number or `chatId`), `message` |

## 3. Resources

_(N/A — chat/message state is live and session-scoped; tools cover it.)_

## 4. Prompts

| Prompt name | Steps (in order) |
|---|---|
| `reply_flow` | `list_chats` → `get_messages` for context → draft a reply → show it and wait for user go-ahead → `send_message` |
