import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildPrompt, launchUrl, lessonKey, MAX_URL_LENGTH, orderQuestions } from "./interview";
import { loadQuestions, parseNotes } from "./notes-parser";

const NOTES = `# Cheat sheet
Intro text.

---

## Lesson 0: Basics

**Key points**
- not a question

**Interview questions**
1. What is X?
   - *Answer:* X is a thing.
   - ⚠️ Watch out for Y.
2. Why Z?
   - *Answer:* Because.

---

## Lesson 2: Later

**Interview questions**
1. Last one?
   - *Answer:* Yes.

**Mistakes**
1. not a question either

## Lesson 1: No questions here
`;

const qs = parseNotes(NOTES, "proj/notes.md");

test("parseNotes extracts questions and answers, and skips other blocks", () => {
  assert.deepEqual(
    qs.map((q) => [q.id, q.lesson, q.lessonTitle, q.question]),
    [
      ["proj/notes.md#0.1", 0, "Basics", "What is X?"],
      ["proj/notes.md#0.2", 0, "Basics", "Why Z?"],
      ["proj/notes.md#2.1", 2, "Later", "Last one?"],
    ],
  );
  assert.equal(qs[0].answer, "X is a thing.\n- ⚠️ Watch out for Y.");
  assert.equal(qs[2].answer, "Yes.");
});

test("the real notes parse into lessons with answers", () => {
  const real = loadQuestions([fileURLToPath(new URL("../../notes", import.meta.url))]);
  assert.ok(real.length >= 6);
  assert.deepEqual(real.slice(0, 6).map((q) => `${q.lesson}.${q.index}`), ["0.1", "0.2", "0.3", "1.1", "1.2", "1.3"]);
  assert.ok(real.every((q) => q.answer.length > 0));
});

test("orderQuestions: linear, byLesson, random, filter and limit", () => {
  const other = parseNotes("## Lesson 1: Other\n**Interview questions**\n1. Q?\n   - *Answer:* A.", "other/notes.md");
  const all = [...qs, ...other];
  const ids = (list: typeof all) => list.map((q) => q.id);

  assert.deepEqual(ids(orderQuestions(all, "linear")), ids(all));
  assert.deepEqual(ids(orderQuestions(all, "byLesson")), [
    "proj/notes.md#0.1",
    "proj/notes.md#0.2",
    "other/notes.md#1.1",
    "proj/notes.md#2.1",
  ]);

  const shuffled = orderQuestions(all, "random", { seed: 42 });
  assert.deepEqual(ids(shuffled), ids(orderQuestions(all, "random", { seed: 42 }))); // same seed, same order
  assert.deepEqual(ids(shuffled).sort(), ids(all).sort()); // nothing lost or repeated

  assert.deepEqual(ids(orderQuestions(all, "linear", { lessons: [lessonKey(other[0])] })), ["other/notes.md#1.1"]);
  assert.deepEqual(orderQuestions(all, "linear", { lessons: [] }), []);
  assert.equal(orderQuestions(all, "linear", { limit: 2 }).length, 2);
});

test("buildPrompt lists every question in order with its reference", () => {
  const prompt = buildPrompt(qs);
  assert.ok(prompt.indexOf("1. [Lesson 0: Basics] What is X?") < prompt.indexOf("3. [Lesson 2: Later] Last one?"));
  assert.match(prompt, /REFERENCE: X is a thing\./);
  assert.match(prompt, /exactly ONE question at a time/);
});

test("buildPrompt switches the interviewer tone by style", () => {
  assert.match(buildPrompt(qs), /friendly and honest/);
  const critical = buildPrompt(qs, "critical");
  assert.match(critical, /No praise/);
  assert.doesNotMatch(critical, /friendly and honest/);
});

test("launchUrl pre-fills short prompts and falls back to the bare page for long ones", () => {
  const short = launchUrl("claude", "hi there");
  assert.deepEqual(short, { url: "https://claude.ai/new?q=hi%20there", prefilled: true });
  const long = launchUrl("chatgpt", "x".repeat(MAX_URL_LENGTH));
  assert.deepEqual(long, { url: "https://chatgpt.com/", prefilled: false });
});
