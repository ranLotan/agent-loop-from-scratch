import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "node:url";

/** Models and their $ per million tokens: [input, output]. Used for run costs and by the eval. */
export const MODELS = {
  opus: { id: "claude-opus-5-5", price: [4, 20] },
  sonnet: { id: "claude-sonnet-5-5", price: [2, 10] },
  haiku: { id: "claude-haiku-5-5", price: [0.1, 0.5] },
} as const satisfies Record<string, { id: string; price: readonly [number, number] }>;

/** One place to change the model. The eval (lesson 6) showed Haiku is as good as Opus here, at ~1/36 of the cost. */
export const MODEL = MODELS.haiku.id;

/** $ for a run, from token counts. Unknown models count as Opus, so a cost is never under-reported. */
export function costOf(model: string, usage: { input: number; output: number }): number {
  const [input, output] = (Object.values(MODELS).find((m) => m.id === model) ?? MODELS.opus).price;
  return (usage.input * input + usage.output * output) / 1_000_000;
}

let client: Anthropic | undefined;

/**
 * The SDK client, created on first use, so importing this module has no side effects (tests, the API).
 * Reads ANTHROPIC_API_KEY from the repo root's .env, by path: the API server's working directory is apps/api.
 * Never hardcode a key.
 */
export function getClient(): Anthropic {
  if (!client) {
    try {
      process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
    } catch {
      // No .env: the SDK reports the missing key itself.
    }
    client = new Anthropic();
  }
  return client;
}
