// Entry point: wires the real store into the app and listens on loopback only.
// Run with: npm run dev -w apps/api   (or npm run dev for API + web together)

import { listAllMonths, loadRules, loadTransactions } from "../../../src/store";
import { createApp } from "./app";

try {
  process.loadEnvFile(); // optional API_PORT; secrets stay server-side
} catch {
  // No .env: defaults are fine for a read-only API.
}

const port = Number(process.env.API_PORT ?? 3000);
// 127.0.0.1, not 0.0.0.0: the API is not reachable from the local network.
const host = "127.0.0.1";

createApp({ listMonths: listAllMonths, loadTransactions, loadRules }).listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
