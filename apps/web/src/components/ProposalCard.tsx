import { useState } from "react";
import { api, type Answer, type ProposalCharge, type ProposalWithCharges } from "../api";
import { formatMoney } from "../format";

interface ProposalCardProps {
  proposal: ProposalWithCharges;
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
  // "Charge by charge": one category per charge, keyed by transaction id. Every charge starts at the proposal.
  const [split, setSplit] = useState(false);
  const [perCharge, setPerCharge] = useState<Record<string, string>>(() =>
    Object.fromEntries(p.charges.map((c) => [c.id, categories.includes(p.category) ? p.category : (categories[0] ?? "")])),
  );
  const [alsoByHand, setAlsoByHand] = useState(true);

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
      <Charges
        charges={p.charges}
        month={p.month}
        // Only while splitting: a dropdown per row. A new object each change, so React sees new state.
        choice={
          split
            ? {
                categories,
                value: perCharge,
                onChange: (id, c) => setPerCharge((prev) => ({ ...prev, [id]: c })),
                disabled: busy,
              }
            : undefined
        }
      />
      {p.newCategoryIdea && (
        <p className="muted" dir="auto">
          💡 Suggested new category: {p.newCategoryIdea}
        </p>
      )}
      {p.confidence === "low" && (
        <p className="muted">Low confidence: the name doesn't say what was bought, so a rule may be wrong next month.</p>
      )}

      {split ? (
        <div className="actions">
          <label>
            <input type="checkbox" checked={alsoByHand} onChange={(e) => setAlsoByHand(e.target.checked)} disabled={busy} />
            {" Always by hand from now on"}
          </label>
          <button
            disabled={busy}
            onClick={() =>
              send({
                kind: "per_charge",
                categories: perCharge,
                byHand: alsoByHand,
              })
            }
            title="Each charge gets its own category; no rule"
          >
            Save each charge
          </button>
          <button disabled={busy} onClick={() => setSplit(false)}>
            Cancel
          </button>
        </div>
      ) : (
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

          <button
            disabled={busy || (creating && !newName.trim())}
            onClick={() => send(ruleAnswer)}
            title="Every charge from this merchant, every month"
          >
            Rule for this merchant
          </button>
          <button disabled={busy || creating} onClick={() => send({ kind: "once", category })} title="This month's charges only, no rule">
            This month only
          </button>
          <button disabled={busy} onClick={() => send({ kind: "by_hand" })} title="Never ask the agent again; you categorize each charge">
            Always by hand
          </button>
          {p.charges.length > 1 && (
            <button disabled={busy} onClick={() => setSplit(true)} title="Pick a category for each charge, e.g. BIT transfers">
              Charge by charge…
            </button>
          )}
          <button disabled={busy} onClick={() => send({ kind: "skip" })} title="Decide later">
            Skip
          </button>
        </div>
      )}

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

/** What was actually bought: the charges one answer will categorize (date, amount, and what Cal adds about them). */
interface ChargeChoice {
  categories: string[];
  value: Record<string, string>;
  onChange: (id: string, category: string) => void;
  disabled: boolean;
}

function Charges({ charges, month, choice }: { charges: ProposalCharge[]; month: string; choice?: ChargeChoice }) {
  if (!charges.length) return <p className="muted">No charges from this merchant on the {month} statement anymore.</p>;
  return (
    <table className="data-table charges">
      <caption className="muted">
        {charges.length === 1 ? "1 charge" : `${charges.length} charges`} on the {month} statement
      </caption>
      <tbody>
        {charges.map((c) => (
          <tr key={c.id}>
            <td className="num">{c.date}</td>
            <td className="num">
              {formatMoney(c.amount, c.currency)}
              {c.originalAmount !== null && c.originalCurrency !== null && (
                <div className="sub">
                  {c.installments ? "purchase" : "originally"} {formatMoney(c.originalAmount, c.originalCurrency)}
                </div>
              )}
            </td>
            <td>
              {c.installments && `payment ${c.installments.number} of ${c.installments.total}`}
              {c.memo && (
                <div className="sub" dir="auto">
                  {c.memo}
                </div>
              )}
            </td>
            {choice && (
              <td>
                <select
                  value={choice.value[c.id]}
                  onChange={(e) => choice.onChange(c.id, e.target.value)}
                  disabled={choice.disabled}
                  dir="auto"
                  aria-label={`Category for the ${c.date} charge`}
                >
                  {choice.categories.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
