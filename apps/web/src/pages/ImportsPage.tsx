import { useState } from "react";
import { ImportHistory } from "../components/ImportHistory";
import { ScrapePanel } from "../components/ScrapePanel";
import { api, StatementImport } from "../api";

export function ImportsPage() {
  // Bumping this number makes ImportHistory load again (it's in that component's useApi deps).
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshHistory = () => setRefreshKey((k) => k + 1);

  const [file, setFile] = useState<File | null>(null);
  const [month, setMonth] = useState<string>(""); // empty = the billing month printed on the statement
  const [uploading, setUploading] = useState<boolean>(false);
  const [result, setResult] = useState<StatementImport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); // otherwise the browser submits the form by reloading the page
    if (!file) return;
    setUploading(true);
    setResult(null);
    setError(null);
    api.uploadStatement(file, month || undefined)
      .then((r) => {
        setResult(r);
        refreshHistory();
      })
      .catch((err) => {
        setError((err as Error).message);
      })
      .finally(() => {
        setUploading(false);
      });
  }

  return (
    <section>
      <h1>Imports</h1>

      <h2>Upload a statement</h2>
      <form onSubmit={handleSubmit}>
        {/* A file input can't be controlled (no `value`), so the choice is only read in onChange. */}
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button type="submit" disabled={!file || uploading}>
          {uploading ? "Uploading…" : "Import"}
        </button>
      </form>
      {error && <p role="alert">Error: {error}</p>}
      {result && result.duplicate && (
        <p>
          This exact file was imported before (batch {result.batchId}); nothing changed.
        </p>
      )}
      {result && !result.duplicate && (
        <p>
          Read {result.count} transactions for {result.month}: {result.added} new, {result.updated} updated,{" "}
          {result.missing.length} no longer on the statement.
          {!result.checksOk && (
            <>
              {" "}
              Warning: a section total doesn't match its rows; the parser may be misreading the file.
            </>
          )}
        </p>
      )}

      <hr />

      <h2>Fetch from Cal</h2>
      <ScrapePanel onDone={refreshHistory} />

      <h2>History</h2>
      <ImportHistory refreshKey={refreshKey} />
    </section>
  );
}
