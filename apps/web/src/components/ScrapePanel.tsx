import { useEffect, useState } from "react";
import { api, type ScrapeJob } from "../api";

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Starts a Cal scrape on the server (a background job, ~30 s) and polls it until it finishes. */
export function ScrapePanel({ onDone }: { onDone: () => void }) {
  const [month, setMonth] = useState(thisMonth);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ScrapeJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = jobId !== null && job?.status !== "done" && job?.status !== "failed";

  async function start() {
    setError(null);
    setJob(null);
    try {
      setJobId((await api.startScrape(month)).jobId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Poll every 2 s while a job runs. The cleanup stops the timer: on unmount, or when jobId changes.
  useEffect(() => {
    if (!jobId) return;
    let ignore = false;
    let failures = 0;
    const stop = (message: string) => {
      clearInterval(timer);
      setError(message);
      setJobId(null);
    };
    const timer = setInterval(async () => {
      try {
        const latest = await api.job(jobId);
        if (ignore) return;
        failures = 0;
        setJob(latest);
        if (latest.status !== "running") {
          clearInterval(timer);
          if (latest.status === "done") onDone();
        }
      } catch (err) {
        if (ignore) return;
        const message = (err as Error).message;
        // Jobs live in the API's memory: after a restart the id is unknown.
        if (message === "No such job") return stop("The API restarted during the fetch, so the job was lost. Fetch again.");
        // A blip (e.g. the API reloading after a code change): keep polling for ~10 s before giving up.
        if (++failures >= 5) stop(`Lost contact with the API: ${message}`);
      }
    }, 2000);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
    // onDone is only called when a job finishes; a new onDone function isn't a reason to restart polling.
  }, [jobId]);

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
      {error && <p role="alert">Error: {error}</p>}
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
