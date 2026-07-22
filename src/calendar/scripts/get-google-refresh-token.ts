#!/usr/bin/env node
/**
 * One-time helper: runs the OAuth2 installed-app flow against your own
 * Google account and prints a long-lived refresh token to paste into your
 * environment as GOOGLE_REFRESH_TOKEN.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run google:auth
 *
 * See README.md "Google Calendar" for how to create the OAuth client first.
 */
import { google } from "googleapis";
import http from "node:http";

const PORT = 53_682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars first.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline", // required to get back a refresh_token
  prompt: "consent", // forces a refresh_token even on repeat runs
  scope: ["https://www.googleapis.com/auth/calendar"],
});

console.log("Open this URL, sign in, and approve access:\n");
console.log(authUrl);
console.log(`\nWaiting for the redirect on ${REDIRECT_URI} ...`);

const server = http.createServer((req, res) => {
  void (async () => {
    if (!req.url) return;
    const url = new URL(req.url, REDIRECT_URI);
    if (url.pathname !== "/oauth2callback") {
      res.writeHead(404).end();
      return;
    }

    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (error) {
      res.end(`Authorization denied: ${error}. You can close this tab.`);
      console.error(`\nAuthorization denied: ${error}`);
      server.close();
      process.exit(1);
    }
    if (!code) {
      res.writeHead(400).end("Missing authorization code.");
      return;
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);
      res.end("Authorized — you can close this tab and return to the terminal.");
      server.close();
      if (!tokens.refresh_token) {
        console.error(
          "\nNo refresh_token in the response. Revoke prior access at " +
            "https://myaccount.google.com/permissions and re-run this script " +
            "(Google only issues a refresh_token on first consent, or with prompt=consent)."
        );
        process.exit(1);
      }
      console.log("\nAdd this to your environment:\n");
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      process.exit(0);
    } catch (err) {
      res.writeHead(500).end("Token exchange failed — see terminal.");
      console.error("\nToken exchange failed:", err);
      server.close();
      process.exit(1);
    }
  })();
});

server.listen(PORT);
