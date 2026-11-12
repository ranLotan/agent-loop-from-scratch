import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type MonthLedger, type MonthStatus, type PieSlice } from "../api";
import { PieChart, sliceColor } from "../components/PieChart";
import { TrendChart } from "../components/TrendChart";
import { formatDelta, formatForeign, formatMoney } from "../format";
import { useApi } from "../hooks/useApi";
import { useSelectedMonth } from "../hooks/useSelectedMonth";

const UNCATEGORIZED = "Uncategorized"; // the core's bucket name for charges with no category (src/report.ts)

/**
 * "Did I spend more than I earned this month?" Everything here is by purchase month, and every number comes
 * finished from the server (monthLedger, ledgerTrend, monthStatus): this page only lays them out.
 */
export function DashboardPage() {
  const month = useSelectedMonth();
  // Hooks before any early return: React matches them by call order on every render.
  const ledger = useApi(() => api.ledger(month), [month]);
  const status = useApi(() => api.status(month), [month]);
  const trend = useApi(() => api.trend(month, 6), [month]);
  const categories = useApi(() => api.categories(), []);

  const error = ledger.error ?? status.error;
  if (error) return <p role="alert">Error: {error}</p>;
  if (!ledger.data || !status.data) return <p>Loading…</p>;

  const byHandName = categories.data?.find((c) => c.system)?.name;
  return (
    <section>
      <h1>{month}</h1>
      <StatusStrip status={status.data} byHandName={byHandName} />
      <Hero ledger={ledger.data} />

      <h2>Expenses by category</h2>
      <CategoryBreakdown ledger={ledger.data} />

      <h2>Last 6 months</h2>
      {trend.error && <p role="alert">Error: {trend.error}</p>}
      {trend.data && (
        <>
          <p className="muted">
            <span className="swatch" style={{ background: "var(--series-1)" }} />
            Income <span className="swatch" style={{ background: "var(--series-2)", marginInlineStart: 12 }} />
            Expenses · Net above each month{trend.data.some((p) => p.awaiting > 0) && " · * = items still waiting for confirmation"}
          </p>
          <TrendChart points={trend.data} current={month} />
          <details>
            <summary>As a table</summary>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Income</th>
                  <th className="num">Expenses</th>
                  <th className="num">Net</th>
                </tr>
              </thead>
              <tbody>
                {trend.data.map((p) => (
                  <tr key={p.month}>
                    <td className="num">{p.month}</td>
                    <td className="num">{formatMoney(p.income)}</td>
                    <td className="num">{formatMoney(p.expenses)}</td>
                    <td className="num">
                      {formatDelta(p.net)}
                      {p.awaiting > 0 && <div className="sub">{p.awaiting} waiting</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

/** Card ✓ · Review (3 left) · Manual (1 awaiting), each a link, plus a "Next step" for the first unfinished one. */
function StatusStrip({ status, byHandName }: { status: MonthStatus; byHandName?: string }) {
  const { month, card, review, manual } = status;
  const toReview = review.proposals + review.flags;
  const nextMonth = card.statements[1]?.month;
  const missingStatement = card.statements.find((s) => !s.imported)?.month ?? nextMonth;
  const links = {
    card: `/imports?month=${missingStatement}`,
    review: toReview > 0 || !byHandName ? `/review?month=${month}` : `/transactions?month=${month}&category=${encodeURIComponent(byHandName)}`,
    manual: `/manual?month=${month}`,
  };
  const cardText =
    card.state === "complete" ? "Card ✓"
    : card.state === "partial" ? `Card: up to ${card.asOf?.slice(0, 10) ?? "pending only"}`
    : "Card: not imported";
  const reviewLeft = toReview + review.byHand;
  const nextText = { card: `Import the ${missingStatement} statement`, review: "Review", manual: "Confirm manual items" };

  return (
    <nav className="status-strip" aria-label="Month status">
      <Link className={`status-step ${card.state === "complete" ? "done" : "todo"}`} to={links.card}>
        {cardText}
      </Link>
      <span aria-hidden>·</span>
      <Link className={`status-step ${reviewLeft ? "todo" : "done"}`} to={links.review}>
        {reviewLeft ? `Review (${reviewLeft} left)` : "Review ✓"}
      </Link>
      <span aria-hidden>·</span>
      <Link className={`status-step ${manual.awaiting ? "todo" : "done"}`} to={links.manual}>
        {manual.awaiting ? `Manual (${manual.awaiting} awaiting)` : "Manual ✓"}
      </Link>
      {status.next ? (
        <Link to={links[status.next]}>
          <button type="button">Next step: {nextText[status.next]}</button>
        </Link>
      ) : (
        <strong>Month done ✓</strong>
      )}
    </nav>
  );
}

/** Income − Expenses = Net. Never hides unconfirmed items: they're named beside the number, not added into it. */
function Hero({ ledger }: { ledger: MonthLedger }) {
  const s = ledger.summary;
  const expected = s.awaiting.expectedExpenses + s.awaiting.expectedIncome;
  return (
    <div className="hero">
      {formatMoney(s.income)} income − {formatMoney(s.expenses)} expenses =
      {/* Color is never alone: the sign and the words say the same thing. */}
      <span className={`hero-net ${s.net >= 0 ? "good" : "bad"}`}>
        {formatDelta(s.net)} {s.net >= 0 ? "left over" : "more spent than earned"}
      </span>
      {s.awaiting.count > 0 && (
        <p>
          {s.awaiting.count} item{s.awaiting.count === 1 ? "" : "s"} awaiting confirmation (~{formatMoney(expected)}), not counted yet.
        </p>
      )}
      {s.pendingCard.count > 0 && (
        <p className="muted">
          Includes {s.pendingCard.count} card charge{s.pendingCard.count === 1 ? "" : "s"} not billed yet ({formatMoney(s.pendingCard.amount)}).
        </p>
      )}
      {s.otherCurrencies.count > 0 && (
        <p className="muted">
          Not in Net (shekels only): {s.otherCurrencies.count} charge{s.otherCurrencies.count === 1 ? "" : "s"} in other currencies,{" "}
          {formatForeign(s.otherCurrencies.totals)}.
        </p>
      )}
    </div>
  );
}

/** The pie and its legend. The legend is also the table, so every value is readable without the chart. */
function CategoryBreakdown({ ledger }: { ledger: MonthLedger }) {
  const navigate = useNavigate();
  // Lifted state: the pie and the legend share which slice is hovered, so it lives in their common parent.
  const [hovered, setHovered] = useState<number | null>(null);
  const { pie, byCategory, expenses } = ledger.summary;
  if (!pie.length) return <p className="muted">No expenses in {ledger.month}.</p>;

  /** Only card categories open Transactions. Other spans several; a manual-only one (rent) has no card rows. */
  const onSelect = (slice: PieSlice) => {
    if (slice.grouped) return null;
    const category = slice.category === UNCATEGORIZED ? null : slice.category;
    const onCard = ledger.entries.some((e) => e.source === "card" && e.category === category);
    if (!onCard) return null;
    const filter = category === null ? "source=none" : `category=${encodeURIComponent(category)}`;
    return () => navigate(`/transactions?month=${ledger.month}&${filter}`);
  };
  const notInPie = byCategory.filter((c) => c.amount <= 0);

  return (
    <div className="chart-row">
      <PieChart slices={pie} hovered={hovered} onHover={setHovered} onSelect={onSelect} />
      <table className="data-table legend">
        <thead>
          <tr>
            <th>Category</th>
            <th className="num">Amount</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {pie.map((slice, i) => {
            const select = onSelect(slice);
            return (
              <tr key={slice.category} className={hovered === i ? "hovered" : ""} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
                <td>
                  {/* <bdi> isolates a Hebrew name, so the swatch stays on the left like in English rows. */}
                  <span className="swatch" style={{ background: sliceColor(slice, i) }} />
                  {select ? (
                    <button type="button" className="link-button" onClick={select}>
                      <bdi>{slice.category}</bdi>
                    </button>
                  ) : (
                    <bdi>{slice.category}</bdi>
                  )}
                  {slice.grouped && (
                    <div className="sub" dir="auto">
                      {slice.grouped.join(" · ")}
                    </div>
                  )}
                </td>
                <td className="num">{formatMoney(slice.amount)}</td>
                <td className="num">{slice.percent}%</td>
              </tr>
            );
          })}
          {notInPie.map((c) => (
            <tr key={c.category}>
              <td>
                <bdi>{c.category}</bdi>
                <div className="sub">refunds: not a slice</div>
              </td>
              <td className="num">{formatMoney(c.amount)}</td>
              <td className="num">—</td>
            </tr>
          ))}
          <tr>
            <th>Total</th>
            <th className="num">{formatMoney(expenses)}</th>
            <th />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
