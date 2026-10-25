# Agents: interview cheat sheet

Built lesson by lesson while adding the agent to cal-expense-agent.
Each lesson has key points, then interview questions with the answers we settled on.

---

## Lesson 0: What an agent is

**Key points**
- **Agent:** an LLM in a loop that picks its next action (a tool call), sees the result, and repeats until the goal is met.
  It has five parts: **model, tools, loop, state/memory, stop condition**.
- **Workflow vs. agent:**
  - In a workflow, *code* decides the steps and the LLM fills in one step.
  - In an agent, the *LLM* decides the steps.
  - It's a spectrum. Use the simplest thing that works.
- **What stays in code:** keep anything deterministic out of the LLM, such as fetching, matching, math and totals.
  - Code is cheaper, faster, testable and repeatable, and it can be audited.
  - LLMs are good at judgment and fuzzy matching, and bad at exact arithmetic.
- **In this project:** fetch, categorize and report are code. The agent only proposes categories and judges exceptions, and a human approves.

**Interview questions**
1. What is an AI agent, and how is it different from a single LLM call?
   - *Answer:* A single call is text in, text out. An agent puts the model in a loop with tools:
     the model **asks** for a tool call, **my code runs it** and returns the result, and the model picks the next step.
     It stops when the goal is done or a limit is hit.
   - ⚠️ The model never runs anything itself. Code is the gatekeeper: it can validate, refuse, or ask a human first.
2. When would you *not* use an agent?
   - *Answer:* When the task is **deterministic** (same input → same output) or the steps are known in advance.
     Plain code or a fixed workflow is faster, cheaper, testable and repeatable.
3. In your expense project, why doesn't the LLM compute the monthly totals?
   - *Answer:* Totals have exactly one right answer, so code computes them deterministically and they're easy to test.
     LLMs can make arithmetic mistakes, so exact math is a liability for them. The LLM only gets the judgment calls.

---

## Lesson 1: Your first API call

**Key points**
- **One endpoint:** `messages.create({ model, max_tokens, system, messages })`. Tools and agents are built on top of it.
- **Stateless:** the model remembers nothing between calls. The "conversation" is the `messages` array you resend every time.
- **System vs. user:**
  - `system` holds *my* rules: role, constraints, output format.
  - `messages` holds per-call *data*.
  - Untrusted input (merchant names) goes in messages, never in system.
- **The response is an array of content blocks** (`text`, `thinking`, `tool_use`…), not a string. Filter by `block.type`.
- **`stop_reason`:** `end_turn` = done, `max_tokens` = cut off (handle it!), `tool_use` = wants a tool (lesson 2), `refusal`.
- **Cost = tokens:** Opus 5.5 charges $4/M input and $20/M output. Output is 5× pricier.
- **Real run:** 133 tokens in / 297 out for a one-word answer. Most of the output was *thinking* (Opus 5.5 always thinks) → $0.0065.
  - Lever: a cheaper model or lower effort for simple classification. We measure that in lesson 6.
- **Write the output format for code, not humans:** "category name only". A tool schema enforces it properly (lesson 2).

**Mistakes from my first attempt (worth remembering)**
- `response.type` is always `"message"`. The text lives in `response.content[i].type === "text"`.
- The field names are snake_case: `stop_reason`, not `stopReason`. The value is `"end_turn"`, not `"endrun"`.
- My prompt said "use unknown category", but there was no "unknown" in the list. Rules must not contradict the allowed outputs, so the fallback is `שונות`.
- `max_tokens: 10000` is too generous for one word. Set a cap that matches the expected answer and acts as a cost guard.

**Interview questions**
1. The API is stateless. How does a chatbot "remember" the conversation?
   - *Answer:* The client stores the history and resends the full `messages` array on every call.
     So context grows each turn, which costs more tokens and eventually hits the context window.
     That's why agents trim, summarize, or move facts into long-term memory (files or a DB).
2. What goes in the system prompt, and what goes in the user message? Why does it matter?
   - *Answer:* The system prompt holds stable developer instructions: role, rules, output format.
     The user message holds per-request data.
     Separating them keeps the instructions authoritative and limits prompt injection from untrusted data.
3. Your response came back with `stop_reason: "max_tokens"`. What happened, and what do you do?
   - *Answer:* The output was cut off mid-answer, so the result is incomplete or unparseable.
     Treat it as an error, not a success: raise `max_tokens`, shorten the requested output, or retry.
     Never parse a truncated answer as if it were final.

---

## Lesson 2: Tool calling

**Key points**
- **Tool definition:** `{ name, description, input_schema, strict }`.
  - The **description is a prompt**: the model reads it to decide when and how to call the tool.
  - The **schema is a contract**: code receives typed data instead of free text.
- **The model only asks.** It returns `tool_use` blocks `{ id, name, input }` with `stop_reason: "tool_use"`. My code runs the tool.
- **Round trip:**
  1. user: data
  2. → assistant: `[thinking, tool_use ×N]`
  3. → user: `[tool_result ×N]` (each with `tool_use_id`)
  4. → assistant: text, `end_turn`

  Tool results use the **user** role. Each result is matched to its call by id, and several calls can be in flight at once.
- **Resend the assistant content unchanged**, including the `thinking` block. Its signature lets the model continue its reasoning.
- **`enum` constrains, `description` only suggests.** Without `enum: categories` the model invented "Streaming & Subscriptions", which isn't in my list.
- **`strict: true`** guarantees the input matches *the schema*, not that the schema matches *my code*.
- **Opus 5.5 rejects forced `tool_choice` (`any`/`tool`).** Use `auto`, instruct in the prompt, and check in code that the call happened.
- **Thinking:**
  - Reasoning models think before acting. The thinking is billed as output tokens and hidden by default on Opus 5.5 (`display: "summarized"` shows it).
  - It's adaptive: more thinking for harder calls.

**Mistakes from my attempt**
- **No `enum` on category** → invented categories, and two runs gave two different names for the same merchant.
- **`required: ["reasone"]` while the property was `reason`.** The API accepted it silently.
  I then "fixed" it by renaming the property, which broke the match with the TypeScript interface (`p.reason` → `undefined`).
- **The lesson:** `use.input as CategoryProposal` is a *cast*, not a check. Tool input is external data, so validate it at runtime (Zod, lesson 7).

**Interview questions**
1. Who executes a tool, the model or your code? Why does that matter?
   - *Answer:* My code. The model only returns a `tool_use` request (name + JSON input).
     That makes code the gatekeeper: it can validate the input, refuse, rate-limit, log, or ask a human before anything with side effects happens.
     The model has no direct access to my systems.
2. How do you guarantee structured output, and what if the model doesn't call the tool?
   - *Answer:* A tool with a JSON schema, `strict: true`, and `enum`s for closed sets, plus runtime validation in code, since strict covers the schema and not my types.
     A call isn't guaranteed (`tool_choice` auto, and forced calls are rejected on some models), so code checks for a `tool_use` block and retries or reports a failure. Never assume compliance.
3. Walk through the messages of one tool round trip.
   - *Answer:*
     1. `user`: the task.
     2. `assistant`: `thinking` + one or more `tool_use` blocks, each with an id. `stop_reason` is `tool_use`.
     3. Code runs each tool and sends one `user` message with a `tool_result` per call, matched by `tool_use_id` (`is_error: true` on failure).
     4. The model replies with text and `end_turn`, or asks for more tools. Repeating step 3 is the agent loop.
4. `strict: true` was on but you still got `undefined`. What does strict guarantee?
   - *Answer:* That the model's input is valid against the schema I sent: types, enums, required fields.
     It can't know my TypeScript interface. A schema/interface mismatch passes strict and fails in my code.
     Fix: a single source of truth (generate the schema from a Zod type) and runtime validation.

---

## Lesson 3: The agent loop

**Key points**
- **An agent is a while-loop around the tool round trip:**
  call → push the assistant turn → stop unless `tool_use` → run tools → push the results → repeat.
  The model decides how many turns it needs, and code decides the limits.
- **The guards matter more than the happy path:**
  - **`maxIterations`:** caps the cost of a model that never stops calling tools.
  - **Tool errors → `is_error: true` results, not exceptions:** the model reads the error and can recover (for example, it re-sends the exact merchant name).
  - **`max_tokens` / `refusal` → stop:** never run tool input from a cut-off turn.
  - **Copy the input `messages`:** don't mutate the caller's data.
- **The loop is generic; the tools plug in.** The loop dispatches by name through `handlers[block.name]` and knows nothing about categories. Domain logic lives in the handlers.
- **`await` inside a `try`:** an error thrown by a handler is caught and becomes a result. `.map` with an async handler would give Promises, so use `for...of`.
- **Roles alternate:** user (task) → assistant (tool_use) → user (tool_result) → … → assistant (text, `end_turn`).
  The assistant turn goes back unchanged so the `tool_result` ids refer to a real request, and the thinking signature stays valid.
- **Testing:**
  - The client is injected (dependency injection), so tests use a **fake model** with scripted replies. No network, no cost, the same result every run.
  - Fakes test the *control flow*; evals test the model's *judgment* (lesson 6).
- **Real run:** 10 merchants on 2026-10 cost $0.057. BIT/PAYBOX transfers came back as `low` confidence, as instructed.

**Mistakes from my attempt**
- I pasted category-specific code (`CategoryProposal`, `merchants`) into the generic loop, and `process.exit(1)` killed the test runner.
- **`filter(...).join("")` gave `"[object Object]"`:** filter keeps block *objects*. You need `.map(b => b.text)` before `join`.
- I put `"max_iterations"` in `finalText`. Each field should have one meaning: status goes in `stoppedBy`, model output goes in `finalText`.

**Interview questions**
1. Write the agent loop in pseudocode. What are its stop conditions?
   - *Answer:* `while iterations < max`:
     1. Call the model with the full history, and append its reply as an assistant message.
     2. If `stop_reason` is `max_tokens` or `refusal` → stop without running tools.
     3. If it isn't `tool_use` → done (`end_turn`).
     4. Otherwise run each `tool_use` and append one user message with all the `tool_result`s (matched by id). Repeat.

     It also stops when the iteration limit is hit. A real system adds a token or cost budget and a timeout.
2. A tool throws an exception mid-run. What should the loop do, and why?
   - *Answer:* Catch it and return a `tool_result` with `is_error: true` and the error message. Don't crash.
     The model sees the error and can retry with fixed input, try another tool, or explain the failure.
     That ability to recover is a big part of why you use an agent at all.
     Crashing loses the whole conversation and every token spent so far.
3. How do you unit-test an agent when the model's output is non-deterministic?
   - *Answer:* Split the two concerns.
     - **The control flow** (dispatch, error handling, limits, message shape) is deterministic code: inject the model client and replace it with a fake that returns scripted responses. No network or cost, and the tests are exact.
     - **The model's judgment** is tested separately with evals: a labeled dataset scored for accuracy, tracked across prompt and model changes.
4. Why must the loop never mutate the `messages` array it receives?
   - *Answer:* Arrays are passed by reference, so pushing to the caller's array changes their data behind their back.
     Reusing the same starting messages for a second run, or comparing models, would then start from a polluted history.
     Copy the array (`[...opts.messages]`) and return the new history in the result.

---

## Lesson 4: Tool design

**Key points**
- **With several tools, the model chooses** which one to call, when, and how often. The descriptions and the system prompt steer that choice, so tool design is mostly writing.
- **A good tool description says:**
  - what it does and returns (including what the fields mean)
  - when to use it, and when *not* to
  - whether it has side effects
  - how to fill the tricky fields, with an example
- **Read-only vs. side effects:** read-only tools (`lookup_merchant`) are safe to call freely. Tools that record or change things need guards: an `enum` of allowed ids, validation in the handler, and later human approval.
- **Small, focused tools:** one job each, a clear name, a narrow schema. They're easier for the model to choose correctly, and easier to test.
- **Code finds, the model judges.** Deterministic checks (`src/candidates.ts`) find exception candidates; the model only decides which ones matter and explains why.
  The thresholds need tuning: the first version gave 53 candidates a month, and with a ₪300 minimum it gave 9. Noisy alerts get ignored.
- **Prefetch vs. a tool (context engineering):**
  - Every tool call costs a full round trip that resends the whole history.
  - Small, deterministic, known-needed data should go in the prompt up front.
  - Use tools for retrieval that's large, conditional, open-ended or expensive.
- **Parallel tool calls:** one turn can hold many `tool_use` blocks. The October run made 16 tool calls in just 3 model calls.
- **Prompt injection:** merchant names are untrusted input. The system prompt says they are data, never instructions.
- **Real run (2026-10):** 3 lookups, 10 proposals, and 3 flags out of 9 candidates (6 routine ones left alone). Cost $0.117, double lesson 3, because of the extra input: tool definitions, candidates and lookup results.

**Mistakes from my attempt**
- **I described `flag_exception` in terms of category fit** ("low fit → warning"). That's `propose_category`'s job.
  An exception is about the *charge* being unusual (large, new, duplicate, unexpected subscription), whatever its category.
- **The lookup's `rule` field was useless for the merchants being categorized,** since only merchants with no rule get reviewed. Check that each tool field has a real use.

**Interview questions**
1. What makes a good tool description?
   - *Answer:* It's a prompt for choosing and using the tool. It says what the tool does and returns (including the meaning of the fields), when to use it, when *not* to, whether it has side effects, and how to fill the tricky parameters, with an example.
     Vague descriptions cause wrong or wasted calls.
2. How do you treat read-only tools differently from tools with side effects?
   - *Answer:* Read-only tools can be called freely; the worst case is a wasted call.
     Side-effect tools get guards: a narrow schema (enums of valid ids), validation in the handler, idempotency or duplicate checks, and human approval before anything irreversible.
     Keep the two kinds in separate tools, so the risky ones are few and easy to audit.
3. When should context go in the prompt, and when behind a tool?
   - *Answer:* **In the prompt** when it's small, deterministic, and known to be needed, like each merchant's recent history. That saves round trips, since every tool call resends the whole conversation.
     **Behind a tool** when it's large, only sometimes needed, open-ended (the model decides what to search), or expensive to fetch.
4. Why does code find the exception candidates instead of the model scanning every transaction?
   - *Answer:* The checks are deterministic (thresholds, new merchant, duplicates), so code is exact, free, and testable.
     The model only judges the few candidates (9 instead of ~100 transactions), which is cheaper, and its job stays focused on what it's good at: is this actually unusual, and how do I explain it?
