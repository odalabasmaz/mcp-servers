#!/usr/bin/env node
/**
 * One-time helper: opens a headless-but-visible-QR WhatsApp Web session,
 * prints a QR code to scan from your phone (WhatsApp → Settings → Linked
 * devices → Link a device), and persists the resulting session under
 * WHATSAPP_AUTH_DIR (default ~/.whatsapp-mcp-server/auth) so the real MCP
 * server (server.ts) can reconnect headlessly without re-pairing each run.
 *
 * Usage:
 *   npm run whatsapp:pair
 *
 * See README.md for the Terms-of-Service / ban-risk disclosure — this
 * automates the same WhatsApp Web client behind the scenes, which is not
 * the officially sanctioned integration path.
 */
import os from "node:os";
import path from "node:path";
import qrcodeTerminal from "qrcode-terminal";
// whatsapp-web.js is CommonJS; Node's ESM loader can't statically see its
// named exports, so it must come in via the default import and be destructured.
import whatsappWebPkg from "whatsapp-web.js";
const { Client, LocalAuth } = whatsappWebPkg;

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR ?? path.join(os.homedir(), ".whatsapp-mcp-server", "auth");

console.log(`Pairing session will be saved to: ${AUTH_DIR}`);
console.log("Waiting for QR code...\n");

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
  puppeteer: { headless: true },
});

client.on("qr", (qr) => {
  qrcodeTerminal.generate(qr, { small: true });
  console.log("\nScan this QR code from WhatsApp on your phone:");
  console.log("Settings → Linked devices → Link a device\n");
});

client.on("authenticated", () => {
  console.log("Authenticated — finishing sync...");
});

client.on("ready", () => {
  const number = client.info?.wid?.user;
  console.log(`\nPaired successfully (${number ?? "unknown number"}).`);
  console.log("You can now start the real server: npm run start:whatsapp");
  process.exit(0);
});

client.on("auth_failure", (message) => {
  console.error(`\nAuthentication failed: ${message}`);
  process.exit(1);
});

client.initialize().catch((err) => {
  console.error("\nFailed to start pairing session:", err);
  process.exit(1);
});
