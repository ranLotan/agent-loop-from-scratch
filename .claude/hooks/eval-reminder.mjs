#!/usr/bin/env node
// PostToolUse hook (Edit|Write): after a change to the files the evals measure
// (prompt, tools, loop, model), remind Claude and the user to run the paid evals.
// It only reminds: `npm run eval -- --run` costs money, so a human decides when to run it.
// Fires once per session, so it doesn't repeat on every edit.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const file = String(input.tool_input?.file_path ?? "").replace(/\\/g, "/");
if (!/src\/agent\/(prompt|tools|handlers|loop|client|merchants)\.ts$/.test(file)) process.exit(0);

const marker = join(tmpdir(), `claude-cal-expense-eval-${input.session_id ?? "unknown"}`);
if (existsSync(marker)) process.exit(0);
writeFileSync(marker, file);

const name = file.split("/").pop();
process.stdout.write(
  JSON.stringify({
    systemMessage: `⚠ ${name} is measured by the evals. Run \`npm run eval -- --run\` (costs money) before calling this done.`,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        `You changed ${name}, which the evals test (prompt, tools, loop or model). ` +
        "Per CLAUDE.md, the user must run `npm run eval -- --run` after such changes. It costs money: " +
        "remind them at the end of your turn and do not run it without asking.",
    },
  }),
);
