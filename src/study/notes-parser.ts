import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export interface Question {
  id: string; // e.g. "cal-expence-agent/agents.md#0.2": stable across runs
  source: string; // "<project>/<file>", so notes from several projects stay apart
  lesson: number;
  lessonTitle: string;
  index: number; // 1-based position inside the lesson
  question: string;
  answer: string;
}

/**
 * Parses notes written in the cheat-sheet layout:
 *   ## Lesson N: title
 *   **Interview questions**
 *   1. question
 *      - *Answer:* text, with optional sub-bullets
 * Lessons without that block are skipped, so key points never become questions.
 */
export function parseNotes(markdown: string, source: string): Question[] {
  const questions: Question[] = [];
  const sections = markdown.split(/^## /m).slice(1); // text before the first ## is the file intro

  sections.forEach((section, sectionIndex) => {
    const [heading, ...body] = section.split(/\r?\n/);
    const lessonMatch = heading.match(/Lesson\s+(\d+)/i);
    const lesson = lessonMatch ? Number(lessonMatch[1]) : sectionIndex;
    const lessonTitle = heading.replace(/^Lesson\s+\d+\s*[:\-–]\s*/i, "").trim();

    const start = body.findIndex((line) => /^\*\*Interview questions\*\*/i.test(line.trim()));
    if (start === -1) return;

    const items: { question: string; answerLines: string[] }[] = [];
    for (const line of body.slice(start + 1)) {
      if (/^---\s*$/.test(line) || /^\*\*[^*]+\*\*\s*$/.test(line.trim())) break; // section end or a new bold block
      const item = line.match(/^\d+\.\s+(.*)$/);
      if (item) items.push({ question: item[1].trim(), answerLines: [] });
      else if (items.length && line.trim()) items[items.length - 1].answerLines.push(line);
    }

    items.forEach((item, i) =>
      questions.push({
        id: `${source}#${lesson}.${i + 1}`,
        source,
        lesson,
        lessonTitle,
        index: i + 1,
        question: item.question,
        answer: formatAnswer(item.answerLines),
      }),
    );
  });

  return questions;
}

/** Drops the common indent and the "*Answer:*" marker, keeping sub-bullets readable. */
function formatAnswer(lines: string[]): string {
  if (!lines.length) return "";
  const indent = Math.min(...lines.map((l) => l.match(/^\s*/)![0].length));
  return lines
    .map((l) => l.slice(indent).replace(/^- \*Answer:\*\s*/, ""))
    .join("\n")
    .trim();
}

/** Reads every *.md in each dir. Source is "<parent folder>/<file>", e.g. "cal-expence-agent/agents.md". */
export function loadQuestions(dirs: string[]): Question[] {
  return dirs.flatMap((dir) => {
    const abs = resolve(dir);
    if (!existsSync(abs)) {
      console.warn(`Notes dir not found: ${abs}`);
      return [];
    }
    const project = basename(resolve(abs, ".."));
    return readdirSync(abs)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .flatMap((f) => parseNotes(readFileSync(join(abs, f), "utf8"), `${project}/${f}`));
  });
}
