// Follows a background job on the server (a scrape, an agent run) until it finishes: polls every 2 s.
// Shared by ScrapePanel and the Review page, so the polling rules live in one place.

import { useEffect, useState } from "react";
import { api, type Job } from "../api";

export interface JobState<T> {
  job: (Job & { result?: T }) | null;
  error: string | null;
  running: boolean;
}

/** Pass the job id once the server returns it (null = nothing to follow). `onDone` runs once, on success. */
export function useJob<T>(jobId: string | null, onDone?: (result: T) => void): JobState<T> {
  const [job, setJob] = useState<(Job & { result?: T }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setJob(null);
    setError(null);
    if (!jobId) return;
    let ignore = false;
    let failures = 0;
    const timer = setInterval(async () => {
      try {
        const latest = (await api.job(jobId)) as Job & { result?: T };
        if (ignore) return;
        failures = 0;
        setJob(latest);
        if (latest.status !== "running") {
          clearInterval(timer);
          if (latest.status === "done") onDone?.(latest.result as T);
        }
      } catch (err) {
        if (ignore) return;
        const message = (err as Error).message;
        // Jobs live in the API's memory: after a restart the id is unknown.
        if (message === "No such job") {
          clearInterval(timer);
          setError("The API restarted while this was running, so the job was lost. Start it again.");
        } else if (++failures >= 5) {
          // A blip (e.g. the API reloading after a code change) is tolerated for ~10 s.
          clearInterval(timer);
          setError(`Lost contact with the API: ${message}`);
        }
      }
    }, 2000);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
    // onDone is read when the job finishes; a new onDone function isn't a reason to restart polling.
  }, [jobId]);

  const running = jobId !== null && error === null && job?.status !== "done" && job?.status !== "failed";
  return { job, error, running };
}
