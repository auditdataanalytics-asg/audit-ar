/* eslint-disable @typescript-eslint/no-require-imports */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { OAuth2Client } from "google-auth-library";

// One-time helper to obtain a Google Drive refresh token for the app's personal
// Drive account.
//
//   1. Create an OAuth 2.0 Client (type: Web application) in Google Cloud Console.
//   2. Add the redirect URI printed below to that client.
//   3. Run: npx tsx scripts/get-drive-refresh-token.ts <CLIENT_ID> <CLIENT_SECRET>
//      (or set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in the env)
//   4. Authorize in the browser; the refresh token is printed to the console.

const PORT = 5555;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.argv[2];
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.argv[3];

if (!clientId || !clientSecret) {
  console.error(
    "Provide GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (env vars or args).",
  );
  console.error(`Also register this redirect URI on the OAuth client: ${REDIRECT}`);
  process.exit(1);
}

const client = new OAuth2Client({ clientId, clientSecret, redirectUri: REDIRECT });
const url = client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  // drive.file = the app can only see/manage files IT creates. Non-sensitive,
  // so no Google verification is needed and the refresh token is long-lived
  // (full "drive" scope would expire every 7 days on a personal, unverified app).
  scope: ["https://www.googleapis.com/auth/drive.file"],
});

console.log(`\n1) Register this redirect URI on your OAuth client:\n   ${REDIRECT}`);
console.log(`\n2) Open this URL in a browser and authorize:\n   ${url}\n`);

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.end("ok");
    return;
  }
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) {
    res.end("No authorization code received.");
    return;
  }
  try {
    const { tokens } = await client.getToken(code);
    res.end("Success. You can close this tab and return to the terminal.");
    const rt = tokens.refresh_token;
    if (rt) {
      const envPath = path.resolve(process.cwd(), ".env.local");
      try {
        let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
        if (/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m.test(content)) {
          content = content.replace(/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m, `GOOGLE_OAUTH_REFRESH_TOKEN=${rt}`);
        } else {
          content += `${content.endsWith("\n") ? "" : "\n"}GOOGLE_OAUTH_REFRESH_TOKEN=${rt}\n`;
        }
        fs.writeFileSync(envPath, content);
        console.log("\n✓ Wrote GOOGLE_OAUTH_REFRESH_TOKEN to .env.local\n");
      } catch {
        console.log("\nGOOGLE_OAUTH_REFRESH_TOKEN=" + rt + "\n");
      }
    } else {
      console.log("\nNo refresh token returned (try revoking the app's access and re-running).\n");
    }
  } catch (e) {
    res.end("Error exchanging code. Check the terminal.");
    console.error(e);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log(`Waiting for authorization on ${REDIRECT} ...`);
});
