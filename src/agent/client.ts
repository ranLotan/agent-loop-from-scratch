import Anthropic from "@anthropic-ai/sdk";

try {
  process.loadEnvFile(); // .env → process.env, so the SDK finds ANTHROPIC_API_KEY
} catch {
  // No .env: the SDK will report a missing key on the first call.
}

/** One place to change the model. Lesson 6 measures whether a cheaper one is good enough. */
export const MODEL = "claude-opus-5-5";

/** Reads ANTHROPIC_API_KEY from the environment. Never hardcode a key. */
export const client = new Anthropic();
