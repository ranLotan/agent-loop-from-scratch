import { useState } from "react";
import type { CategoryTrend } from "../api";
import { formatMoney } from "../format";

const W = 640;
const H = 220;
const TOP = 22; // room for the value labels in the cap view
const BOTTOM = 24; // room for the month labels
const GAP = 2; // the surface gap between adjacent bars

/** 1120.5 → "1,121": the cap view's labels above each bar. The table has the exact amounts. */
const compact = (amount: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);

/**
 * Spending per category per month, one shared axis from zero. Two layouts from the same data:
 * - several categories: one bar per category per month in its color, a red outline when over its cap;
 * - one capped category (`trend.single`): its expense bar (green within the cap, red over) beside a cap bar.
 * Scaling to the tallest bar is layout, not money math: every figure shown comes from the server.
 */
export function CategoryTrendChart(props: { trend: CategoryTrend; colors: Map<string, string>; current: string }) {
  const { trend, colors, current } = props;
  const [hovered, setHovered] = useState<string | null>(null);
  const single = trend.single;
  const values = single
    ? single.months.flatMap((m) => [m.expenses, m.cap])
    : trend.rows.flatMap((r) => trend.categories.map((c) => r.amounts[c.category]));
  const max = Math.max(1, ...values);
  const plot = H - TOP - BOTTOM;
  const height = (v: number) => (Math.max(0, v) / max) * plot;
  const slot = W / trend.rows.length;
  const barsPerMonth = single ? 2 : trend.categories.length;
  const bar = Math.max(3, Math.min(22, (slot * 0.75) / barsPerMonth - GAP));
  const label = single
    ? `${single.category}: spending against its ${formatMoney(single.cap)} cap per month (see the table below)`
    : "Spending per selected category per month (see the table below)";

  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <line className="axis" x1={0} x2={W} y1={H - BOTTOM} y2={H - BOTTOM} />
      {trend.rows.map((row, i) => {
        const groupWidth = barsPerMonth * bar + (barsPerMonth - 1) * GAP;
        const x0 = slot * i + (slot - groupWidth) / 2;
        const xAt = (k: number) => x0 + k * (bar + GAP);
        const dim = hovered !== null && hovered !== row.month ? "dimmed" : "";
        const bold = row.month === current ? 700 : 400;
        const rect = (k: number, value: number, fill: string, title: string, extra: Record<string, unknown> = {}) => (
          // rx rounds the data end; the bar sits on the baseline.
          <rect x={xAt(k)} y={H - BOTTOM - height(value)} width={bar} height={height(value)} rx={Math.min(4, bar / 2)} fill={fill} className={dim} {...extra}>
            <title>{title}</title>
          </rect>
        );

        return (
          // A transparent hit area wider than the bars makes hovering easy.
          <g key={row.month} onMouseEnter={() => setHovered(row.month)} onMouseLeave={() => setHovered(null)}>
            <rect x={slot * i} y={0} width={slot} height={H} fill="transparent" />
            {single
              ? (() => {
                  const m = single.months[i];
                  const state = m.over ? `${formatMoney(-m.remaining)} over` : `${formatMoney(m.remaining)} left`;
                  return (
                    <>
                      {rect(0, m.expenses, m.over ? "var(--net-bad)" : "var(--net-good)", `${m.month}: ${formatMoney(m.expenses)} of ${formatMoney(m.cap)} (${state})`)}
                      {rect(1, m.cap, "var(--cap-fill)", `${m.month} cap: ${formatMoney(m.cap)}`, { className: `cap-bar-mark ${dim}` })}
                      <text x={xAt(0) + bar / 2} y={H - BOTTOM - height(m.expenses) - 4} textAnchor="middle" fontWeight={m.over ? 700 : 400} className={m.over ? "bad-text" : ""}>
                        {compact(m.expenses)}
                      </text>
                    </>
                  );
                })()
              : trend.categories.map((c, k) => {
                  const value = row.amounts[c.category];
                  const over = row.over.includes(c.category);
                  const title = `${row.month} ${c.category}: ${formatMoney(value)}${c.cap !== null ? ` of ${formatMoney(c.cap)}${over ? " (over cap)" : ""}` : ""}`;
                  return (
                    <g key={c.category}>
                      {rect(k, value, colors.get(c.category) ?? "var(--series-other)", title, over ? { className: `over ${dim}` } : {})}
                    </g>
                  );
                })}
            <text x={slot * i + slot / 2} y={H - 6} textAnchor="middle" fontWeight={bold}>
              {row.month}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
