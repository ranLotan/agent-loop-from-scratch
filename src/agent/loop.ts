// Lesson 3: the agent loop, by hand. YOUR PART: the body of runLoop.
//
// Lesson 2's propose.ts made exactly two calls. A real agent doesn't know in advance how
// many turns it needs, so it loops: call → run requested tools → send results → call again,
// until the model stops asking for tools (or a safety limit trips).
//
// Tests: npm test (src/agent/loop.test.ts drives this with a FAKE model; no network, no cost).

import type Anthropic from "@anthropic-ai/sdk";

/** The one SDK method the loop needs. The real `client` fits it, and so does a fake in tests. */
export interface ModelClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

/** Tool name → function that runs it. Return a string for the model; throw to report an error. */
export type ToolHandlers = Record<string, (input: unknown) => string | Promise<string>>;

export interface LoopOptions {
  client: ModelClient;
  model: string;
  system: string;
  tools: Anthropic.Tool[];
  handlers: ToolHandlers;
  messages: Anthropic.MessageParam[]; // the starting conversation (usually one user message)
  maxIterations?: number; // max model calls; default 10
  maxTokens?: number; // max_tokens per call; default 4000
}

export interface LoopResult {
  /** Why the loop ended: the model finished, or a guard stopped it. */
  stoppedBy: "end_turn" | "max_iterations" | "max_tokens" | "refusal";
  /** The full conversation, including every tool_use and tool_result. */
  messages: Anthropic.MessageParam[];
  /** Number of model calls made. */
  iterations: number;
  /** Tokens summed over all calls. */
  usage: { input: number; output: number };
  /** The text blocks of the last response, joined. */
  finalText: string;
}

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const { client, model, system, tools, handlers, maxIterations = 10, maxTokens = 4000 } = opts;
  const messages = [...opts.messages]; // copy: don't mutate the caller's array
  const usage = { input: 0, output: 0 };

  let iter = 0;
  let response: Anthropic.Message | undefined;

  // HINT 1 (finalText): return the text of the last response's text blocks, joined ("" if none).
  //   Same idea as hello.ts: go over response.content and keep blocks where type === "text".
  //   Shape: let out = ""; for (const block of response?.content ?? []) { if (...) out += block.text; } return out;
  const finalText = (blocks: Anthropic.Message): string => blocks.content.filter(b => b.type === "text").map(b => b.text).join("");

  while (iter < maxIterations) {
    iter++;
    // a. call the model and count tokens  ✅ yours
    response = await client.messages.create({ model, max_tokens: maxTokens, system, tools, messages });
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;

    // b. the model's turn goes into history, unchanged  ✅ yours
    messages.push({ role: "assistant", content: response.content });

    // c. cut-off turn → stop WITHOUT running tools  ✅ yours
    const stop = response.stop_reason;
    if (stop === "max_tokens" || stop === "refusal") {
      return { stoppedBy: stop, messages, iterations: iter, usage, finalText: finalText(response) };
    }

    // d. the model is done  ✅ yours (checking stop_reason directly is the standard form)
    if (stop !== "tool_use") {
      return { stoppedBy: "end_turn", messages, iterations: iter, usage, finalText: finalText(response) };
    }

    // e. run every tool the model asked for → one tool_result each
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue; // skip thinking/text blocks

      const handler = handlers[block.name];
      if (handler == undefined){
        results.push({type: "tool_result", tool_use_id: block.id, content: `Unknown tool: ${block.name}`, is_error: true });
        continue;
      }
      try {
        results.push({type: "tool_result", tool_use_id: block.id, content: await handler(block.input)});
      }
      catch (err){
        results.push({ type: "tool_result", tool_use_id: block.id, content: String(err), is_error: true });
      }
    }

    // all results go back in ONE user message  ✅ yours
    messages.push({ role: "user", content: results });
  }

  return { stoppedBy: "max_iterations", messages, iterations: iter, usage, finalText: "max_iterations" };
}
