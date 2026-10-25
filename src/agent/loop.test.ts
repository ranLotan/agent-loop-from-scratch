// Tests for runLoop with a FAKE model: scripted responses, no network, no cost, same result every run.
// This is how you test agent control flow: the model's judgment is non-deterministic, but the
// loop around it (dispatch, error handling, limits) must be exact.

import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { runLoop, type LoopOptions, type ModelClient } from "./loop";

type Block = Anthropic.ContentBlock;
const text = (t: string): Block => ({ type: "text", text: t, citations: null }) as Block;
const toolUse = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input }) as Block;

function reply(stop_reason: Anthropic.StopReason, content: Block[]): Anthropic.Message {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "fake",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as Anthropic.Message;
}

/** Returns the scripted replies in order and records what the loop sent each time. */
function fakeClient(replies: Anthropic.Message[]) {
  const sent: Anthropic.MessageParam[][] = [];
  const client: ModelClient = {
    messages: {
      async create(params) {
        sent.push(structuredClone(params.messages)); // snapshot: the loop keeps appending to its array
        const next = replies.shift();
        if (!next) throw new Error("Fake model: no more scripted replies (the loop called too many times)");
        return next;
      },
    },
  };
  return { client, sent };
}

function options(client: ModelClient, extra: Partial<LoopOptions> = {}): LoopOptions {
  return {
    client,
    model: "fake",
    system: "test",
    tools: [],
    handlers: {},
    messages: [{ role: "user", content: "go" }],
    ...extra,
  };
}

const resultsOf = (msg: Anthropic.MessageParam) => msg.content as Anthropic.ToolResultBlockParam[];

test("model answers right away: one call, no tools run", async () => {
  const { client, sent } = fakeClient([reply("end_turn", [text("done")])]);
  const result = await runLoop(options(client));

  assert.equal(result.stoppedBy, "end_turn");
  assert.equal(result.iterations, 1);
  assert.equal(result.finalText, "done");
  assert.equal(sent.length, 1);
  assert.deepEqual(result.usage, { input: 10, output: 5 });
});

test("tool round trip: runs the handler and sends a tool_result with the matching id", async () => {
  const calls: unknown[] = [];
  const { client, sent } = fakeClient([
    reply("tool_use", [toolUse("t1", "echo", { word: "hi" })]),
    reply("end_turn", [text("finished")]),
  ]);
  const result = await runLoop(
    options(client, { handlers: { echo: (input) => (calls.push(input), "echoed") } }),
  );

  assert.deepEqual(calls, [{ word: "hi" }]);
  assert.equal(result.iterations, 2);
  assert.equal(result.finalText, "finished");
  // The 2nd call must carry: user, assistant(tool_use), user(tool_result)
  const second = sent[1];
  assert.deepEqual(second.map((m) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(resultsOf(second[2]), [{ type: "tool_result", tool_use_id: "t1", content: "echoed" }]);
  assert.deepEqual(result.usage, { input: 20, output: 10 });
});

test("several tool_use blocks in one turn → all results in ONE user message, in order", async () => {
  const { client, sent } = fakeClient([
    reply("tool_use", [text("on it"), toolUse("a", "echo", 1), toolUse("b", "echo", 2)]),
    reply("end_turn", [text("ok")]),
  ]);
  await runLoop(options(client, { handlers: { echo: (n) => `got ${n}` } }));

  const results = resultsOf(sent[1][2]);
  assert.deepEqual(results.map((r) => [r.tool_use_id, r.content]), [["a", "got 1"], ["b", "got 2"]]);
});

test("unknown tool and throwing handler → is_error results, the loop keeps going", async () => {
  const { client, sent } = fakeClient([
    reply("tool_use", [toolUse("x", "nope", {}), toolUse("y", "boom", {})]),
    reply("end_turn", [text("recovered")]),
  ]);
  const result = await runLoop(
    options(client, { handlers: { boom: () => { throw new Error("disk full"); } } }),
  );

  assert.equal(result.stoppedBy, "end_turn");
  const [unknown, failed] = resultsOf(sent[1][2]);
  assert.equal(unknown.is_error, true);
  assert.match(String(unknown.content), /nope/);
  assert.equal(failed.is_error, true);
  assert.match(String(failed.content), /disk full/);
});

test("model never stops asking for tools → stops at maxIterations", async () => {
  const forever = Array.from({ length: 10 }, (_, i) => reply("tool_use", [toolUse(`t${i}`, "echo", i)]));
  const { client, sent } = fakeClient(forever);
  const result = await runLoop(options(client, { handlers: { echo: () => "again" }, maxIterations: 3 }));

  assert.equal(result.stoppedBy, "max_iterations");
  assert.equal(result.iterations, 3);
  assert.equal(sent.length, 3);
});

test("cut-off turn (max_tokens) → stops without running its tools", async () => {
  let ran = false;
  const { client } = fakeClient([reply("max_tokens", [toolUse("t1", "echo", { partial: true })])]);
  const result = await runLoop(options(client, { handlers: { echo: () => ((ran = true), "x") } }));

  assert.equal(result.stoppedBy, "max_tokens");
  assert.equal(ran, false);
});

test("does not mutate the caller's messages array", async () => {
  const start: Anthropic.MessageParam[] = [{ role: "user", content: "go" }];
  const { client } = fakeClient([reply("end_turn", [text("done")])]);
  const result = await runLoop(options(client, { messages: start }));

  assert.equal(start.length, 1);
  assert.equal(result.messages.length, 2); // user + assistant
});
