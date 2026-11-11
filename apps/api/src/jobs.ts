// Background jobs for slow work (a Cal scrape takes ~30 s). In memory: one user, one process,
// and losing a job on restart is fine. The request returns a job id at once; the UI polls it.

export interface Job {
  id: string;
  kind: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
}

export function createJobs() {
  const jobs = new Map<string, Job>();
  let nextId = 1;

  return {
    /** Starts `work` unless a job of the same kind is still running; then returns that one instead. */
    start(kind: string, work: () => Promise<unknown>): { job: Job; alreadyRunning: boolean } {
      const running = [...jobs.values()].find((j) => j.kind === kind && j.status === "running");
      if (running) return { job: running, alreadyRunning: true };

      const job: Job = { id: String(nextId++), kind, status: "running", startedAt: new Date().toISOString() };
      jobs.set(job.id, job);
      work().then(
        (result) => Object.assign(job, { status: "done", result, finishedAt: new Date().toISOString() }),
        (err) => Object.assign(job, { status: "failed", error: (err as Error).message, finishedAt: new Date().toISOString() }),
      );
      return { job, alreadyRunning: false };
    },

    get: (id: string) => jobs.get(id),
  };
}
