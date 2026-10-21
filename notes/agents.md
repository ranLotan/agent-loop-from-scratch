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
