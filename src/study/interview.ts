import type { Question } from "./notes-parser";

export type OrderMode = "linear" | "random" | "byLesson";
export type Target = "claude" | "chatgpt";

/** Identifies one lesson across projects, e.g. "cal-expence-agent/agents.md#1". */
export const lessonKey = (q: Question) => `${q.source}#${q.lesson}`;

export interface OrderOptions {
  lessons?: string[]; // lessonKey values to keep; missing = all
  limit?: number;
  seed?: number; // fixes the shuffle, for tests
}

/**
 * Ordering lives in code, not in the prompt: an LLM asked to "pick randomly" isn't
 * really random, and it tends to skip or repeat items. The prompt just says "ask in this order".
 */
export function orderQuestions(all: Question[], mode: OrderMode, opts: OrderOptions = {}): Question[] {
  const keep = opts.lessons ? new Set(opts.lessons) : null;
  let qs = all.filter((q) => !keep || keep.has(lessonKey(q))); // input is already in document order

  if (mode === "random") qs = shuffle(qs, opts.seed);
  if (mode === "byLesson") qs = [...qs].sort((a, b) => a.lesson - b.lesson); // stable: document order within a lesson

  return opts.limit && opts.limit > 0 ? qs.slice(0, opts.limit) : qs;
}

function shuffle<T>(items: T[], seed = Math.floor(Math.random() * 2 ** 32)): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Tiny seeded PRNG, so a test can expect the same shuffle every run. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type InterviewerStyle = "regular" | "critical";

const STYLE_RULES: Record<InterviewerStyle, string> = {
  regular: "- Tone: friendly and honest, like a fair interviewer who wants me to succeed.",
  critical: `- Tone: a demanding senior interviewer. Be direct, factual and to the point. No praise, compliments or pats on the back ("great answer", "good job"), and don't soften criticism.
- Mention what was right in a few words at most. Spend the feedback on what was missing, imprecise or wrong, and call out vague terms and hand-waving explicitly.
- Score strictly: 5 only for a complete, precise answer an expert would give. A vague or partial answer gets 2 at most.
- If an answer is shallow, ask one short follow-up question that probes deeper before you score it, like a real interviewer would.`,
};

export function buildPrompt(qs: Question[], style: InterviewerStyle = "regular"): string {
  const list = qs
    .map((q, i) => {
      const answer = q.answer ? q.answer.replace(/\n/g, "\n   ") : "(no reference answer; judge it yourself)";
      return `${i + 1}. [Lesson ${q.lesson}: ${q.lessonTitle}] ${q.question}\n   REFERENCE: ${answer}`;
    })
    .join("\n\n");

  return `You are a technical interviewer for an AI / LLM-agents engineering role. Run a mock interview with me using the ${qs.length} questions below.

Rules:
- Ask exactly ONE question at a time, in the exact order listed. Don't skip, merge, reorder or repeat questions.
- Ask only the question text, and don't show the REFERENCE. Then stop and wait for my answer.
- After I answer:
  - give a score from 1 to 5
  - say in one line what I got right and what I missed or got wrong, compared with the REFERENCE (correct but differently worded answers count as correct)
  - give a 2–3 sentence model answer, the way I should say it in a real interview
  - then ask the next question.
- If I say "hint", give a short hint without revealing the answer. If I say "skip", score it 0, show the model answer, and move on.
- I may answer by voice, so keep your replies short and easy to listen to.
${STYLE_RULES[style]}
- After the last question, show a summary table (question #, topic, score), my average, and the 2–3 weakest topics to review.

Start now with question 1.

Questions:

${list}`;
}

const BASE_URL: Record<Target, string> = {
  claude: "https://claude.ai/new",
  chatgpt: "https://chatgpt.com/",
};

/** Longer URLs get cut off or rejected, so past this length we open the bare page and rely on the clipboard. */
export const MAX_URL_LENGTH = 6000;

export function launchUrl(target: Target, prompt: string): { url: string; prefilled: boolean } {
  const url = `${BASE_URL[target]}?q=${encodeURIComponent(prompt)}`;
  return url.length <= MAX_URL_LENGTH ? { url, prefilled: true } : { url: BASE_URL[target], prefilled: false };
}
