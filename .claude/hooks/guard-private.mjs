#!/usr/bin/env node
// PreToolUse guard: keeps credentials and personal financial data out of Claude's context.
//
// Why a hook and not only `permissions.deny`: deny rules cover the file tools (Read/Edit),
// but `cat .env` through Bash/PowerShell is a different tool. This script sees every
// tool call and decides in code, the same idea as the agent's tools in src/agent/:
// a tool call is only a request, and code decides whether it runs.
//
// Fails closed: if this script crashes, settings.json has `onFailure: "block"`.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const tool = input.tool_name;
const args = input.tool_input ?? {};

const PRIVATE_PATHS = [
  // .env, .env.local, ... but not .env.example (that one is committed and has no secrets)
  { re: /(^|[\\/\s"'=:])\.env(?!\.example)(\.[\w-]+)?(?![\w.-])/i, what: ".env (bank and API credentials)" },
  { re: /data[\\/]+(transactions|raw|reports|proposals|evals)([\\/]|\b)/i, what: "personal financial data under data/" },
  { re: /data[\\/]+memory\.md/i, what: "data/memory.md (personal notes)" },
  { re: /data[\\/]+app\.db/i, what: "the local SQLite database" },
];

// Shell-only checks: printing a secret variable or dumping the whole environment.
const SECRET_NAMES = /\b(ANTHROPIC_API_KEY|CAL_USERNAME|CAL_PASSWORD)\b/;
const ENV_DUMP = /(^|[;&|]\s*)(printenv|env|set)\s*($|[;&|])|\b(gci|ls|dir|get-childitem)\s+env:/i;

function stringsToCheck() {
  switch (tool) {
    case "Bash":
    case "PowerShell":
      return [args.command];
    case "Grep": // check where it searches, not the regex it searches for
      return [args.path, args.glob];
    case "Glob":
      return [args.path, args.pattern];
    default: // Read, Edit, Write, NotebookEdit
      return [args.file_path, args.notebook_path];
  }
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Blocked by .claude/hooks/guard-private.mjs: ${reason}. ` +
          "Work from samples/ or a temp fixture instead, or ask the user to run the command with `!`.",
      },
    }),
  );
  process.exit(0);
}

for (const s of stringsToCheck().filter((v) => typeof v === "string")) {
  for (const { re, what } of PRIVATE_PATHS) if (re.test(s)) deny(`touches ${what}`);
  if (tool === "Bash" || tool === "PowerShell") {
    if (SECRET_NAMES.test(s)) deny("mentions a secret variable (ANTHROPIC_API_KEY / CAL_*)");
    if (ENV_DUMP.test(s)) deny("would print the whole environment");
  }
}
// No output + exit 0 = no opinion; the normal permission flow continues.
