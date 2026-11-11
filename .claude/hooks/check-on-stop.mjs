#!/usr/bin/env node
// Stop hook: when Claude finishes a turn with code changes, run typecheck + tests.
//
// CLAUDE.md says both "must pass after every change". This turns that request into a check.
// - Skips when no .ts/.tsx/.sql file is changed, or when the tree is unchanged since the
//   last check (so Q&A turns cost nothing and a known failure isn't reported twice).
// - On failure it blocks the stop once, so Claude sees the errors. It never blocks twice
//   in a row (stop_hook_active), and it tells Claude not to "fix" the user's own
//   in-progress code: this is a learning project and some code is the user's to write.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raw = readFileSync(0, "utf8");
const input = raw.trim() ? JSON.parse(raw) : {};
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const sh = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const hash = (s) => createHash("sha256").update(s).digest("hex");

// 1. Which code files differ from HEAD (staged, unstaged or untracked)?
const status = sh("git status --porcelain -uall");
const changed = status
  .split("\n")
  .filter(Boolean)
  .map((line) => line.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""))
  .filter((p) => /\.(ts|tsx|sql)$/.test(p) && !p.startsWith("data/"));
if (changed.length === 0) process.exit(0);

// 2. Fingerprint the current tree, so the same state isn't checked twice.
const fingerprint = hash(
  status +
    changed
      .map((p) => {
        const f = join(root, p);
        if (!existsSync(f)) return `${p}:deleted`;
        const st = statSync(f);
        return `${p}:${st.size}:${st.mtimeMs}`;
      })
      .join("\n"),
);
const stateFile = join(tmpdir(), `claude-cal-expense-check-${hash(root).slice(0, 8)}.json`);
try {
  if (JSON.parse(readFileSync(stateFile, "utf8")).fingerprint === fingerprint) process.exit(0);
} catch {
  // no previous state
}

// 3. Run the checks.
function run(name, cmd) {
  try {
    sh(cmd);
    return null;
  } catch (e) {
    const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    const lines = out.split("\n");
    const relevant = lines.filter((l) => /error TS|^not ok|error: |location: /.test(l));
    return `${name} failed:\n${(relevant.length ? relevant : lines.slice(-30)).slice(0, 40).join("\n")}`;
  }
}
const failures = [run("npm run typecheck", "npm run typecheck"), run("npm test", "npm test")].filter(Boolean);
writeFileSync(stateFile, JSON.stringify({ fingerprint, ok: failures.length === 0 }));

if (failures.length === 0) {
  process.stdout.write(JSON.stringify({ systemMessage: "✓ typecheck + tests pass" }));
  process.exit(0);
}

const summary = failures.join("\n\n");
if (input.stop_hook_active) {
  // Already nudged once this stop; let the turn end, but keep the user informed.
  process.stdout.write(JSON.stringify({ systemMessage: `✗ still failing:\n${summary}` }));
  process.exit(0);
}
process.stdout.write(
  JSON.stringify({
    decision: "block",
    systemMessage: "✗ typecheck/tests failing (sent to Claude)",
    reason:
      "Stop hook (.claude/hooks/check-on-stop.mjs): CLAUDE.md requires typecheck and tests to pass after every change.\n\n" +
      `${summary}\n\n` +
      "Fix failures your own changes caused. If a failure is in code the user is writing themselves " +
      "(their in-progress milestone work or a lesson TODO), do NOT fix it: tell them which test fails and why, then stop.",
  }),
);
