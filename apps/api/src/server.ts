// Entry point: wires the real core into the app and listens on loopback only.
// Run with: npm run dev -w apps/api   (or npm run dev for API + web together)

import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { realDeps } from "./deps";

try {
  // The repo root's .env, by path: `npm run dev` starts this server with apps/api as the working directory,
  // so a plain loadEnvFile() would look for apps/api/.env and silently find nothing.
  // API_PORT, and the Cal login for scrapes. Secrets stay server-side.
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // No .env: reading works; a scrape will report the missing variables.
}

const port = Number(process.env.API_PORT ?? 3000);
// 127.0.0.1, not 0.0.0.0: the API is not reachable from the local network.
const host = "127.0.0.1";

// The database opens on first use, after .env (and its optional DB_PATH) is loaded above.
createApp(realDeps()).listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
