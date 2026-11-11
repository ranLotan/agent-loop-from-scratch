import { api } from "../api";
import { useApi } from "../hooks/useApi";

const SOURCE_LABELS = { xlsx: "Excel", csv: "CSV", scraper: "Scrape", "json-migration": "JSON migration" } as const;

/** Every import, newest first. Change `refreshKey` to load it again (e.g. after an upload). */
export function ImportHistory({ refreshKey }: { refreshKey: number }) {
  const { data, error, loading } = useApi(() => api.imports(), [refreshKey]);

  if (error) return <p role="alert">Error: {error}</p>;
  if (loading || !data) return <p>Loading…</p>;
  if (!data.length) return <p className="muted">Nothing imported yet.</p>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Source</th>
          <th>File</th>
          <th>Month</th>
          <th>Rows</th>
          <th>Totals check</th>
        </tr>
      </thead>
      <tbody>
        {data.map((b) => {
          const checksOk = b.checks?.every((c) => Math.abs(c.expected - c.actual) < 0.01);
          return (
            <tr key={b.id}>
              <td className="num">{new Date(b.createdAt).toLocaleString()}</td>
              <td>{SOURCE_LABELS[b.source]}</td>
              <td dir="auto">{b.fileName ?? "—"}</td>
              <td className="num">{b.billingMonth}</td>
              <td className="num">{b.txCount}</td>
              <td>{b.checks ? (checksOk ? "✓" : "✗ totals differ") : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
