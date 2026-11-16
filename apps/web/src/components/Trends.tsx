import { useSearchParams } from "react-router";
import { api, type CategoryTrend, type LedgerTrend, type PieSlice } from "../api";
import { categoryColors } from "../chart-colors";
import { formatDelta, formatMoney } from "../format";
import { useApi } from "../hooks/useApi";
import { CategoryTrendChart } from "./CategoryTrendChart";
import { TrendChart } from "./TrendChart";

const PERIODS = [3, 6, 9, 12] as const;
const DEFAULT_PERIOD = 6;

/**
 * The period and the category filter live in the URL (?period=9&cats=a&cats=b), not in component state:
 * a reload or a shared link shows the same view. In Angular terms this is reading ActivatedRoute.queryParamMap
 * and navigating with new queryParams; useSearchParams gives both in one hook. No `cats` = the server's default
 * selection (the capped categories); an empty `cats=` = nothing selected.
 */
function useTrendParams() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = Number(searchParams.get("period"));
  const period = (PERIODS as readonly number[]).includes(raw) ? raw : DEFAULT_PERIOD;
  const cats = searchParams.has("cats") ? searchParams.getAll("cats").filter((c) => c !== "") : null;

  // The function form starts from the current params, so ?month= and anything else on the URL is kept.
  const update = (change: (next: URLSearchParams) => void) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        change(next);
        return next;
      },
      { replace: true }, // a filter click isn't a page to go "back" to
    );
  const setPeriod = (n: number) => update((next) => (n === DEFAULT_PERIOD ? next.delete("period") : next.set("period", String(n))));
  const setCats = (list: string[]) =>
    update((next) => {
      next.delete("cats");
      if (list.length) list.forEach((c) => next.append("cats", c));
      else next.set("cats", "");
    });
  return { period, cats, setPeriod, setCats };
}

/** Both trend charts, for the n months ending with `month`. Every number comes finished from the server. */
export function Trends({ month, pie }: { month: string; pie: PieSlice[] }) {
  const { period, cats, setPeriod, setCats } = useTrendParams();
  const trend = useApi(() => api.trend(month, period), [month, period]);
  // The key joins the list: an array in deps would be a new object on every render (and refetch forever).
  const catsKey = cats === null ? null : cats.join("\u0000");
  const byCategory = useApi(() => api.categoryTrend(month, period, cats), [month, period, catsKey]);

  return (
    <>
      <div className="section-head">
        <h2>Last {period} months</h2>
        <div className="segmented" role="group" aria-label="Period">
          {PERIODS.map((n) => (
            <button key={n} type="button" aria-pressed={n === period} onClick={() => setPeriod(n)}>
              {n} mo
            </button>
          ))}
        </div>
      </div>
      {trend.error && <p role="alert">Error: {trend.error}</p>}
      {trend.data && <IncomeVsExpenses trend={trend.data} month={month} />}

      <h2>Spending by category</h2>
      {byCategory.error && <p role="alert">Error: {byCategory.error}</p>}
      {byCategory.data && <CategorySpending trend={byCategory.data} month={month} pie={pie} onChange={setCats} />}
    </>
  );
}

function IncomeVsExpenses({ trend, month }: { trend: LedgerTrend; month: string }) {
  const { points, totals } = trend;
  return (
    <>
      <p className="muted">
        <span className="swatch" style={{ background: "var(--series-1)" }} />
        Income <span className="swatch" style={{ background: "var(--series-2)", marginInlineStart: 12 }} />
        Expenses · Net above each month{points.some((p) => p.awaiting > 0) && " · * = items still waiting for confirmation"} · the period
        applies to both charts
      </p>
      <div className="trend-row">
        <TrendChart points={points} current={month} />
        <aside className="summary-card" aria-label={`Totals for ${totals.months} months`}>
          <span className="summary-label">Total · {totals.months} months</span>
          <div className="summary-line">
            <span>
              <span className="swatch" style={{ background: "var(--series-1)" }} />
              Income
            </span>
            <span className="strong">{formatMoney(totals.income)}</span>
          </div>
          <div className="summary-line">
            <span>
              <span className="swatch" style={{ background: "var(--series-2)" }} />
              Expenses
            </span>
            <span className="strong">{formatMoney(totals.expenses)}</span>
          </div>
          <hr />
          <div className="summary-line">
            <span className="strong">Net</span>
            <span className={`summary-big ${totals.net >= 0 ? "good" : "bad"}`}>{formatDelta(totals.net)}</span>
          </div>
          <span className="sub">
            Avg per month: income {formatMoney(totals.avgIncome)} · expenses {formatMoney(totals.avgExpenses)}
          </span>
        </aside>
      </div>
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
            {points.map((p) => (
              <tr key={p.month}>
                <td className="num">{p.month}</td>
                <td className="num">{formatMoney(p.income)}</td>
                <td className="num">{formatMoney(p.expenses)}</td>
                <td className={`num ${p.net >= 0 ? "good" : "bad"}`}>
                  {formatDelta(p.net)}
                  {p.awaiting > 0 && <div className="sub">{p.awaiting} waiting</div>}
                </td>
              </tr>
            ))}
            <tr className="total-row">
              <th>Total</th>
              <th className="num">{formatMoney(totals.income)}</th>
              <th className="num">{formatMoney(totals.expenses)}</th>
              <th className={`num ${totals.net >= 0 ? "good" : "bad"}`}>{formatDelta(totals.net)}</th>
            </tr>
          </tbody>
        </table>
      </details>
    </>
  );
}

function CategorySpending(props: { trend: CategoryTrend; month: string; pie: PieSlice[]; onChange: (cats: string[]) => void }) {
  const { trend, month, pie, onChange } = props;
  const selected = trend.categories.map((c) => c.category);
  const colors = categoryColors(pie, trend.available.map((a) => a.category));
  const addable = trend.available.filter((a) => !selected.includes(a.category));
  const allSelected = trend.available.length > 0 && addable.length === 0;
  const single = trend.single;

  return (
    <>
      <div className="filter-bar">
        <span className="sub">Show</span>
        {selected.map((name) => (
          // dir="auto": a Hebrew chip reads right to left (swatch on the right, ✕ on the left).
          <span key={name} className="chip filter-chip" dir="auto">
            <span className="swatch" style={{ background: colors.get(name) }} />
            {name}
            <button type="button" aria-label={`Remove ${name}`} onClick={() => onChange(selected.filter((c) => c !== name))}>
              ✕
            </button>
          </span>
        ))}
        {addable.length > 0 && (
          // A <select> is the "+ Add category" menu: keyboard and screen-reader friendly with no extra code.
          // value="" always, so it snaps back to its label after each pick.
          <select className="add-chip" value="" aria-label="Add a category" onChange={(e) => e.target.value && onChange([...selected, e.target.value])}>
            <option value="">+ Add category</option>
            {addable.map((a) => (
              <option key={a.category} value={a.category} dir="auto">
                {a.category}
                {a.cap !== null ? " (capped)" : ""}
              </option>
            ))}
          </select>
        )}
        {trend.available.length > 0 && (
          // One toggle: pressed = every category is shown; clicking it again clears the selection.
          // aria-pressed tells a screen reader it's an on/off button, like the period switch above.
          <button
            type="button"
            className="toggle-chip"
            aria-pressed={allSelected}
            onClick={() => onChange(allSelected ? [] : trend.available.map((a) => a.category))}
          >
            All categories
          </button>
        )}
      </div>

      {!selected.length ? (
        <p className="muted">Pick a category to see its months.</p>
      ) : (
        <>
          {single ? (
            <p className="muted">
              <span className="swatch" style={{ background: "var(--net-good)" }} />
              Expenses, under cap <span className="swatch" style={{ background: "var(--net-bad)", marginInlineStart: 12 }} />
              Expenses, over cap <span className="swatch cap-swatch" style={{ marginInlineStart: 12 }} />
              Cap {formatMoney(single.cap)}
            </p>
          ) : (
            <p className="muted">
              One bar per category per month · red outline = over that category's cap
              {trend.available.some((a) => a.cap !== null) && " · pick a single capped category to see it against its cap"}
            </p>
          )}
          <div className="trend-row">
            <CategoryTrendChart trend={trend} colors={colors} current={month} />
            {single ? (
              <aside className="summary-card" aria-label="Period totals against the cap">
                <span className="summary-label">Total · {single.months.length} months</span>
                <div className="summary-line">
                  <span>Expenses</span>
                  <span className="strong">{formatMoney(single.expenses)}</span>
                </div>
                <div className="summary-line">
                  <span>
                    Cap ({single.months.length} × {formatMoney(single.cap)})
                  </span>
                  <span className="strong">{formatMoney(single.capTotal)}</span>
                </div>
                <hr />
                <div className="summary-line">
                  <span className="strong">{single.remaining >= 0 ? "Under cap by" : "Over cap by"}</span>
                  <span className={`summary-big ${single.remaining >= 0 ? "good" : "bad"}`}>{formatMoney(Math.abs(single.remaining))}</span>
                </div>
              </aside>
            ) : (
              <aside className="summary-card" aria-label="Period totals per category">
                <span className="summary-label">Total · {trend.rows.length} months</span>
                {trend.categories.map((c) => (
                  <div key={c.category} className="summary-line">
                    <span>
                      <span className="swatch" style={{ background: colors.get(c.category) }} />
                      <bdi>{c.category}</bdi>
                    </span>
                    <span className="strong">{formatMoney(c.total)}</span>
                  </div>
                ))}
                <hr />
                <div className="summary-line">
                  <span className="strong">Selected total</span>
                  <span className="summary-big">{formatMoney(trend.total)}</span>
                </div>
              </aside>
            )}
          </div>
          <details>
            <summary>As a table</summary>
            <div className="table-scroll">{single ? <SingleCapTable single={single} /> : <CategoryTable trend={trend} />}</div>
          </details>
        </>
      )}
    </>
  );
}

function CategoryTable({ trend }: { trend: CategoryTrend }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Month</th>
          {trend.categories.map((c) => (
            <th key={c.category} className="num">
              <bdi>{c.category}</bdi>
            </th>
          ))}
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {trend.rows.map((r) => (
          <tr key={r.month}>
            <td className="num">{r.month}</td>
            {trend.categories.map((c) => {
              const over = r.over.includes(c.category);
              return (
                <td key={c.category} className={`num ${over ? "bad" : ""}`}>
                  {formatMoney(r.amounts[c.category])}
                  {over && <span className="visually-hidden"> (over cap)</span>}
                </td>
              );
            })}
            <td className="num">{formatMoney(r.total)}</td>
          </tr>
        ))}
        <tr className="total-row">
          <th>Total</th>
          {trend.categories.map((c) => (
            <th key={c.category} className="num">
              {formatMoney(c.total)}
            </th>
          ))}
          <th className="num">{formatMoney(trend.total)}</th>
        </tr>
      </tbody>
    </table>
  );
}

function SingleCapTable({ single }: { single: NonNullable<CategoryTrend["single"]> }) {
  const leftOrOver = (remaining: number) => (remaining >= 0 ? `${formatMoney(remaining)} left` : `${formatMoney(-remaining)} over`);
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Month</th>
          <th className="num">Expenses</th>
          <th className="num">Cap</th>
          <th className="num">Left / over</th>
        </tr>
      </thead>
      <tbody>
        {single.months.map((m) => (
          <tr key={m.month}>
            <td className="num">{m.month}</td>
            <td className={`num ${m.over ? "bad" : ""}`}>{formatMoney(m.expenses)}</td>
            <td className="num muted">{formatMoney(m.cap)}</td>
            <td className={`num ${m.over ? "bad" : "good"}`}>{leftOrOver(m.remaining)}</td>
          </tr>
        ))}
        <tr className="total-row">
          <th>Total</th>
          <th className="num">{formatMoney(single.expenses)}</th>
          <th className="num">{formatMoney(single.capTotal)}</th>
          <th className={`num ${single.remaining >= 0 ? "good" : "bad"}`}>{leftOrOver(single.remaining)}</th>
        </tr>
      </tbody>
    </table>
  );
}
