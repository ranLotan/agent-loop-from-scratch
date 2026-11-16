import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type CapUsage, type LedgerSummary, type MonthLedger, type MonthStatus, type PieSlice } from "../api";
import { PieChart, sliceColor } from "../components/PieChart";
import { Trends } from "../components/Trends";
import { formatDelta, formatForeign, formatMoney } from "../format";
import { useApi } from "../hooks/useApi";
import { useSelectedMonth } from "../hooks/useSelectedMonth";

const UNCATEGORIZED = "Uncategorized"; // the core's bucket name for charges with no category (src/report.ts)

/**
 * "Did I spend more than I earned this month?" Everything here is by purchase month, and every number comes
 * finished from the server (monthLedger, ledgerTrend, categoryTrend, monthStatus): this page only lays them out.
 */
export function DashboardPage() {
  const month = useSelectedMonth();
  // Hooks before any early return: React matches them by call order on every render.
  const ledger = useApi(() => api.ledger(month), [month]);
  const status = useApi(() => api.status(month), [month]);
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

      <div className="section-head">
        <h2>Expenses by category</h2>
        <CapChips caps={ledger.data.summary.caps} />
      </div>
      <CategoryBreakdown ledger={ledger.data} />

      <Trends month={month} pie={ledger.data.summary.pie} />
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
    // Review is per statement: open it on the statement that has this month's pending items, not on the purchase month.
    review:
      toReview > 0 || !byHandName
        ? `/review?month=${review.statement ?? nextMonth ?? month}`
        : `/transactions?month=${month}&category=${encodeURIComponent(byHandName)}`,
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
  const { pie, byCategory, expenses, caps } = ledger.summary;
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
  const usage = new Map(caps.usage.map((u) => [u.category, u]));
  // Capped categories with nothing spent this month: not a slice, but their cap still deserves a row.
  const unspent = caps.usage.filter((u) => !pie.some((s) => s.category === u.category) && !notInPie.some((c) => c.category === u.category));
  const hasCaps = caps.usage.length > 0;

  return (
    <div className="chart-row">
      <PieChart slices={pie} hovered={hovered} onHover={setHovered} onSelect={onSelect} />
      <table className="data-table legend">
        <thead>
          <tr>
            <th>Category</th>
            {hasCaps && <th className="num">Cap</th>}
            <th className="num">Amount</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {pie.map((slice, i) => {
            const select = onSelect(slice);
            const u = usage.get(slice.category);
            return (
              <tr
                key={slice.category}
                className={[hovered === i ? "hovered" : "", u?.over ? "over-cap" : ""].join(" ")}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* dir="auto": the first letter of the name decides. A Hebrew name reads right to left and sits on the
                    right, swatch first (on its right side); an English name stays on the left. */}
                <td dir="auto">
                  <span className="swatch" style={{ background: sliceColor(slice, i) }} />
                  {select ? (
                    <button type="button" className="link-button" onClick={select}>
                      {slice.category}
                    </button>
                  ) : (
                    slice.category
                  )}
                  {slice.grouped && (
                    <div className="sub" dir="auto">
                      {slice.grouped.join(" · ")}
                    </div>
                  )}
                </td>
                {hasCaps && <CapCell usage={u} />}
                <td className={`num ${u?.over ? "bad strong" : ""}`}>{formatMoney(slice.amount)}</td>
                <td className="num">{slice.percent}%</td>
              </tr>
            );
          })}
          {notInPie.map((c) => (
            <tr key={c.category}>
              <td dir="auto">
                {c.category}
                <div className="sub">refunds: not a slice</div>
              </td>
              {hasCaps && <CapCell usage={usage.get(c.category)} />}
              <td className="num">{formatMoney(c.amount)}</td>
              <td className="num">—</td>
            </tr>
          ))}
          {unspent.map((u) => (
            <tr key={u.category}>
              <td dir="auto">
                {u.category}
                <div className="sub">nothing spent yet</div>
              </td>
              <CapCell usage={u} />
              <td className="num">{formatMoney(0)}</td>
              <td className="num">—</td>
            </tr>
          ))}
          <tr>
            <th>Total</th>
            {hasCaps && <td className="num sub">{formatMoney(caps.total)} capped</td>}
            <th className="num">{formatMoney(expenses)}</th>
            <th />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** "2 caps on track" · "1 cap exceeded", counted by the server. Nothing when no category has a cap. */
function CapChips({ caps }: { caps: LedgerSummary["caps"] }) {
  if (!caps.usage.length) return null;
  const plural = (n: number) => (n === 1 ? "cap" : "caps");
  return (
    <div className="chips">
      {caps.onTrack > 0 && <span className="chip good-chip">{caps.onTrack} {plural(caps.onTrack)} on track</span>}
      {caps.exceeded > 0 && <span className="chip bad-chip">{caps.exceeded} {plural(caps.exceeded)} exceeded</span>}
    </div>
  );
}

/**
 * The cap, green within it or red over it, with a bar of how much is used. The details show on hover AND keyboard
 * focus: it's a <button> only so it can take focus (it does nothing on click), and the same words are its
 * aria-label, so a screen reader doesn't depend on the visual tooltip. "—" for a category without a cap.
 */
function CapCell({ usage: u }: { usage?: CapUsage }) {
  if (!u) return <td className="num muted">—</td>;
  const left = u.over ? `Over by ${formatMoney(-u.remaining)}` : `${formatMoney(u.remaining)} left to spend`;
  const spentOf = `Spent ${formatMoney(u.spent)} of ${formatMoney(u.cap)}`;
  return (
    <td className="num cap-cell">
      <button type="button" className={`cap-button ${u.over ? "bad" : "good"}`} aria-label={`Cap ${formatMoney(u.cap)}. ${spentOf}. ${left}.`}>
        <span className="strong">{formatMoney(u.cap)}</span>
        <span className="cap-bar" aria-hidden>
          {/* Width from the server's usedPercent; past 100 the bar is just full. Layout, not money math. */}
          <span style={{ width: `${Math.min(100, Math.max(0, u.usedPercent))}%` }} />
        </span>
        <span className="cap-tip" aria-hidden>
          <span className="muted">{spentOf}</span>
          <br />
          <span className="strong">{left}</span>
        </span>
      </button>
    </td>
  );
}
