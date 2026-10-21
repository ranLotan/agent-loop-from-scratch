// Interview practice launcher. Run with: npm run interview [-- <extra notes dirs...>] [--no-open]
//
// Serves a local dashboard that turns the Q&A in notes/*.md into a ready-made interviewer prompt
// and opens it in claude.ai or chatgpt.com. The chat app runs the interview (voice mode included)
// on your subscription, so there's no API key and no token cost.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { buildPrompt, launchUrl, orderQuestions, type InterviewerStyle, type OrderMode, type Target } from "./interview";
import { loadQuestions } from "./notes-parser";

const args = process.argv.slice(2);
const NOTES_DIRS = [fileURLToPath(new URL("../../notes", import.meta.url)), ...args.filter((a) => !a.startsWith("--"))];
const PAGE = fileURLToPath(new URL("./dashboard.html", import.meta.url));
const PORT = Number(process.env.INTERVIEW_PORT ?? 4317);

interface PromptRequest {
  mode: OrderMode;
  lessons?: string[];
  limit?: number;
  style?: InterviewerStyle;
}

interface LaunchRequest {
  target: Target;
  prompt: string;
}

async function readJson(req: AsyncIterable<Buffer | string>): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw);
}

const server = createServer(async (req, res) => {
  const send = (status: number, type: string, body: string) => {
    res.writeHead(status, { "content-type": `${type}; charset=utf-8` });
    res.end(body);
  };

  try {
    if (req.method === "GET" && req.url === "/") {
      return send(200, "text/html", readFileSync(PAGE, "utf8")); // read each time, so page edits show on refresh
    }
    if (req.method === "GET" && req.url === "/api/questions") {
      return send(200, "application/json", JSON.stringify(loadQuestions(NOTES_DIRS))); // re-parsed: notes are always fresh
    }
    if (req.method === "POST" && req.url === "/api/prompt") {
      const body = (await readJson(req)) as PromptRequest;
      const qs = orderQuestions(loadQuestions(NOTES_DIRS), body.mode, { lessons: body.lessons, limit: body.limit });
      return send(200, "application/json", JSON.stringify({ prompt: buildPrompt(qs, body.style), count: qs.length }));
    }
    if (req.method === "POST" && req.url === "/api/launch") {
      // Separate from /api/prompt because you may edit the prompt in the page before launching.
      const body = (await readJson(req)) as LaunchRequest;
      return send(200, "application/json", JSON.stringify(launchUrl(body.target, body.prompt)));
    }
    send(404, "text/plain", "Not found");
  } catch (err) {
    send(500, "text/plain", err instanceof Error ? err.message : String(err));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  console.log(`Interview launcher: ${url}`);
  console.log(`Notes dirs:\n  ${NOTES_DIRS.join("\n  ")}`);
  console.log("Ctrl+C to stop.");
  if (!args.includes("--no-open")) openBrowser(url);
});

function openBrowser(url: string) {
  const [cmd, cmdArgs] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref();
}
