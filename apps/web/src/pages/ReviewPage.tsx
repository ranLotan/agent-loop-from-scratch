import { useState } from "react";
import { api, type AgentRunResult, type FlagRow, type ProposalRow } from "../api";
import { ProposalCard } from "../components/ProposalCard";
import { formatMoney } from "../format";
import { useApi } from "../hooks/useApi";
import { useJob } from "../hooks/useJob";
import { useSelectedMonth } from "../hooks/useSelectedMonth";

const ANSWER_LABELS: Record<string, string> = {
  approve: "rule (as proposed)",
  change: "rule (your category)",
  new_category: "rule (new category)",
  once: "this month only",
  by_hand: "always by hand",
  per_charge: "charge by charge",
  note: "note only",
};

export function ReviewPage() {
  const month = useSelectedMonth();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const review = useApi(() => api.review(month), [month, reloadKey]);
  const categories = useApi(() => api.categories(), [reloadKey]);
  const agentCategories = categories.data?.filter((c) => !c.system).map((c) => c.name) ?? [];

  // Running the agent is a background job, like a scrape; the page reloads when it's done.
  const [jobId, setJobId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const run = useJob<AgentRunResult>(jobId, reload);
  async function startRun() {
    setStartError(null);
    try {
      setJobId((await api.startAgentRun(month)).jobId);
    } catch (err) {
      setStartError((err as Error).message);
    }
  }

  const proposals = review.data?.proposals ?? [];
  const flags = review.data?.flags ?? [];
  const pending = proposals.filter((p) => p.status === "pending");
  const answered = proposals.filter((p) => p.status !== "pending");
  const pendingFlags = flags.filter((f) => f.status === "pending");
  const result = run.job?.result;

  return (
    <section>
      <h1>Review, {month}</h1>
      <p className="muted">
        The agent only proposes. Nothing becomes a rule, a note or a category until you answer here (or in{" "}
        <code>npm run approve</code>).
      </p>

      <div className="panel">
        <button onClick={startRun} disabled={run.running}>
          {run.running ? "The agent is working…" : review.data?.run ? "Run the agent again" : "Run the agent"}
        </button>
        {review.data?.run && (
          <span className="muted">
            Last run: {new Date(review.data.run.createdAt).toLocaleString()} · {review.data.run.model}
          </span>
        )}
        {(startError || run.error) && <p role="alert">Error: {startError ?? run.error}</p>}
        {run.job?.status === "failed" && <p role="alert">The run failed: {run.job.error}</p>}
        {result?.nothingToDo && <p>Nothing to ask: every merchant is categorized and nothing looks unusual.</p>}
        {result && !result.nothingToDo && (
          <p className="muted">
            {result.proposals.length} proposal(s), {result.flags.length} flag(s) · {result.usage.input + result.usage.output} tokens ·
            ${result.cost.toFixed(4)}
          </p>
        )}
      </div>

      {review.error && <p role="alert">Error: {review.error}</p>}
      {review.loading && !review.data && <p>Loading…</p>}
      {review.data && !review.data.run && <p>The agent hasn't run on this month yet.</p>}

      {pending.length > 0 && <h2>To review ({pending.length})</h2>}
      {pending.map((p) => (
        <ProposalCard key={p.id} proposal={p} categories={agentCategories} onAnswered={reload} />
      ))}

      {pendingFlags.length > 0 && <h2>Flags ({pendingFlags.length})</h2>}
      {pendingFlags.map((f) => (
        <FlagCard key={f.id} flag={f} onAnswered={reload} />
      ))}

      {review.data?.run && pending.length === 0 && pendingFlags.length === 0 && <p>✓ Everything from this run is answered.</p>}

      {answered.length > 0 && (
        <details>
          <summary>Answered ({answered.length})</summary>
          <ul>
            {answered.map((p) => (
              <li key={p.id} dir="auto">
                {p.merchant}: {answerText(p)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function answerText(p: ProposalRow): string {
  if (!p.answer) return "answered"; // from before M4: only "answered" was recorded
  const label = ANSWER_LABELS[p.answer.kind] ?? p.answer.kind;
  return "category" in p.answer ? `${label}: ${p.answer.category}` : label;
}

function FlagCard({ flag: f, onAnswered }: { flag: FlagRow; onAnswered: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function send(answer: { kind: "ok" } | { kind: "note"; text: string }) {
    setBusy(true);
    setError(null);
    api
      .answerFlag(f.id, answer)
      .then(onAnswered)
      .catch((err) => setError((err as Error).message))
      .finally(() => setBusy(false));
  }

  return (
    <article className="panel proposal">
      <header>
        {f.severity === "warning" ? "⚠" : "ℹ"} {f.date} · <strong dir="auto">{f.merchant}</strong> · {formatMoney(f.amount, f.currency)}
      </header>
      <p dir="auto">{f.explanation}</p>
      <div className="actions">
        <button disabled={busy} onClick={() => send({ kind: "ok" })}>
          OK, seen
        </button>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the agent, e.g. expected, new phone plan" dir="auto" />
        <button disabled={busy || !note.trim()} onClick={() => send({ kind: "note", text: note })}>
          Save note
        </button>
      </div>
      {error && <p role="alert">Error: {error}</p>}
    </article>
  );
}
