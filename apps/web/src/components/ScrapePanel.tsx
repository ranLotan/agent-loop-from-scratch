import { useState } from "react";
import { api, type FetchImport } from "../api";
import { useJob } from "../hooks/useJob";

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Starts a Cal scrape on the server (a background job, ~30 s) and follows it until it finishes. */
export function ScrapePanel({ onDone }: { onDone: () => void }) {
  const [month, setMonth] = useState(thisMonth);
  const [jobId, setJobId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const { job, error, running } = useJob<FetchImport>(jobId, onDone);

  async function start() {
    setStartError(null);
    try {
      setJobId((await api.startScrape(month)).jobId);
    } catch (err) {
      setStartError((err as Error).message);
    }
  }

  const r = job?.result;
  return (
    <div className="panel">
      <label>
        Billing month <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} disabled={running} />
      </label>{" "}
      <button onClick={start} disabled={running || !month}>
        {running ? "Fetching…" : "Fetch from Cal"}
      </button>
      {running && <p className="muted">Logging in to Cal and reading the statement. This takes about 30 seconds.</p>}
      {(startError || error) && <p role="alert">Error: {startError ?? error}</p>}
      {job?.status === "failed" && <p role="alert">Scrape failed: {job.error}</p>}
      {r && (
        <p>
          Fetched {r.count} transactions for {r.month}: {r.added} new, {r.updated} updated, {r.missing.length} no longer on
          the statement.
        </p>
      )}
    </div>
  );
}
