import { Link } from "react-router";
import { api } from "../api";
import { CategoryTable } from "../components/CategoryTable";
import { Stat } from "../components/Stat";
import { formatDelta, formatMoney } from "../format";
import { useApi } from "../hooks/useApi";
import { useSelectedMonth } from "../hooks/useSelectedMonth";

export function DashboardPage() {
  const month = useSelectedMonth();
  const { data, error, loading } = useApi(() => api.summary(month), [month]);
  // Hooks before any early return: React matches them by call order on every render.
  const review = useApi(() => api.review(month), [month]);
  const categories = useApi(() => api.categories(), []);
  const recurring = useApi(() => api.recurringMonth(month), [month]);

  if (error) return <p role="alert">Error: {error}</p>;
  if (loading || !data) return <p>Loading…</p>;

  const { summary, previous } = data;
  const ils = summary.totals.ILS ?? 0;
  const previousIls = previous?.summary.totals.ILS ?? 0;
  const toReview =
    (review.data?.proposals.filter((p) => p.status === "pending").length ?? 0) +
    (review.data?.flags.filter((f) => f.status === "pending").length ?? 0);
  const byHandName = categories.data?.find((c) => c.system)?.name;
  const byHand = summary.byCategory.find((c) => c.category === byHandName)?.count ?? 0;
  const linkTo = (path: string, extra = "") => `${path}?month=${month}${extra}`;
  // Outside the card: recurring items counted at their expected amount. Card-paid ones are already in ils.
  const r = recurring.data;
  const income = r?.summary.income.ILS ?? 0;
  const outside = r?.summary.outsideExpenses.ILS ?? 0;

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
        <Stat label="Agent proposals to review">
          <Link to={linkTo("/review")}>{toReview}</Link>
        </Stat>
        <Stat label="Waiting for you (by hand)">
          {byHandName ? <Link to={linkTo("/transactions", `&category=${encodeURIComponent(byHandName)}`)}>{byHand}</Link> : byHand}
        </Stat>
      </div>

      {r && r.occurrences.length > 0 && (
        <>
          <h2>Income and expenses</h2>
          <div className="stats">
            <Stat label="Income (recurring)">{formatMoney(income)}</Stat>
            <Stat label="Card spending">{formatMoney(ils)}</Stat>
            <Stat label="Outside the card (recurring)">{formatMoney(outside)}</Stat>
            <Stat label="Left over">{formatDelta(income - ils - outside)}</Stat>
          </div>
          <p className="muted">
            <Link to={linkTo("/recurring")}>Recurring items</Link>: {r.summary.paidByCard} paid by card
            {r.summary.notSeen > 0 && `, ${r.summary.notSeen} not on the statement`}. Shekel amounts only.
          </p>
        </>
      )}

      <p className="muted">
        Categories: {summary.bySource.manual > 0 && `${summary.bySource.manual} edited by you · `}
        {summary.bySource.agent > 0 && `${summary.bySource.agent} from approved agent proposals · `}
        {summary.bySource.rule} from your rules · {summary.bySource.cal} from Cal's sector · {summary.bySource.none}{" "}
        uncategorized
      </p>

      <h2>By category</h2>
      <CategoryTable summary={summary} previous={previous?.summary ?? null} />
    </section>
  );
}
