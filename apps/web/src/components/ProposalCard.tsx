import { useState } from "react";
import { api, type Answer, type ProposalRow } from "../api";

interface ProposalCardProps {
  proposal: ProposalRow;
  /** Your categories, without the built-in by-hand bucket ("Always by hand" covers that). */
  categories: string[];
  onAnswered: () => void;
}

const NEW = "__new__";

/**
 * One pending proposal and the owner's choices. Every button sends an Answer; the server runs it through
 * decide(), the same policy as `npm run approve`, so the dashboard can't apply anything the CLI wouldn't.
 */
export function ProposalCard({ proposal: p, categories, onAnswered }: ProposalCardProps) {
  const [category, setCategory] = useState(p.category);
  const [newName, setNewName] = useState(p.newCategoryIdea ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creating = category === NEW;

  function send(answer: Answer) {
    setBusy(true);
    setError(null);
    api
      .answerProposal(p.id, answer)
      .then(onAnswered)
      .catch((err) => setError((err as Error).message))
      .finally(() => setBusy(false));
  }

  // One "Rule" button covers three answers: the proposed category (approve), another one (change), or a new one.
  const ruleAnswer: Answer = creating
    ? { kind: "new_category", category: newName }
    : category === p.category
      ? { kind: "approve" }
      : { kind: "change", category };

  return (
    <article className="panel proposal">
      <header>
        <strong dir="auto">{p.merchant}</strong> → <span dir="auto">{p.category}</span>{" "}
        <span className={`badge badge-${p.confidence}`}>{p.confidence}</span>
      </header>
      <p className="muted" dir="auto">
        {p.reason}
      </p>
      {p.newCategoryIdea && (
        <p className="muted" dir="auto">
          💡 Suggested new category: {p.newCategoryIdea}
        </p>
      )}
      {p.confidence === "low" && (
        <p className="muted">Low confidence: the name doesn't say what was bought, so a rule may be wrong next month.</p>
      )}

      <div className="actions">
        <select value={category} onChange={(e) => setCategory(e.target.value)} dir="auto" disabled={busy}>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value={NEW}>+ New category…</option>
        </select>
        {creating && <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category name" dir="auto" />}

        <button disabled={busy || (creating && !newName.trim())} onClick={() => send(ruleAnswer)} title="Every charge from this merchant, every month">
          Rule for this merchant
        </button>
        <button disabled={busy || creating} onClick={() => send({ kind: "once", category })} title="This month's charges only, no rule">
          This month only
        </button>
        <button disabled={busy} onClick={() => send({ kind: "by_hand" })} title="Never ask the agent again; you categorize each charge">
          Always by hand
        </button>
        <button disabled={busy} onClick={() => send({ kind: "skip" })} title="Decide later">
          Skip
        </button>
      </div>

      <div className="actions">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Or just leave a note for the agent" dir="auto" />
        <button disabled={busy || !note.trim()} onClick={() => send({ kind: "note", text: note })}>
          Save note
        </button>
      </div>
      {error && <p role="alert">Error: {error}</p>}
    </article>
  );
}
