import { api } from "../api";
import { CategoryTable } from "../components/CategoryTable";
import { Stat } from "../components/Stat";
import { formatDelta, formatMoney } from "../format";
import { useApi } from "../hooks/useApi";
import { useSelectedMonth } from "../hooks/useSelectedMonth";

export function DashboardPage() {
  const month = useSelectedMonth();
  const { data, error, loading } = useApi(() => api.summary(month), [month]);

  if (error) return <p role="alert">Error: {error}</p>;
  if (loading || !data) return <p>Loading…</p>;

  const { summary, previous } = data;
  const ils = summary.totals.ILS ?? 0;
  const previousIls = previous?.summary.totals.ILS ?? 0;

  return (
    <section>
      <h1>{data.month}</h1>

      <div className="stats">
        <Stat label="Total spent">
          {summary.currencies.map((currency) => (
            <div key={currency}>{formatMoney(summary.totals[currency], currency)}</div>
          ))}
        </Stat>
        <Stat label={previous ? `₪ vs ${previous.month}` : "₪ vs last month"}>
          {previous ? formatDelta(ils - previousIls) : "—"}
        </Stat>
        <Stat label="Transactions">{summary.count}</Stat>
        <Stat label="Uncategorized">{summary.bySource.none}</Stat>
      </div>

      <p className="muted">
        Categories: {summary.bySource.rule} from your rules · {summary.bySource.cal} from Cal's sector ·{" "}
        {summary.bySource.none} uncategorized
      </p>

      <h2>By category</h2>
      <CategoryTable summary={summary} previous={previous?.summary ?? null} />
    </section>
  );
}
