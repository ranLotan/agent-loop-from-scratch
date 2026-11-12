import { useState } from "react";
import type { TrendPoint } from "../api";
import { formatDelta, formatMoney } from "../format";

const W = 640;
const H = 220;
const TOP = 28; // room for the Net labels above the bars
const BOTTOM = 24; // room for the month labels
const BAR = 18;

/**
 * Income vs expenses per month, two bars side by side, one shared axis from zero (never two scales).
 * Net is written above each pair instead of drawn as a third series. Scaling to the tallest bar is layout,
 * not money math: every figure shown comes from the server.
 */
export function TrendChart({ points, current }: { points: TrendPoint[]; current: string }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const max = Math.max(1, ...points.flatMap((p) => [p.income, p.expenses]));
  const plot = H - TOP - BOTTOM;
  const height = (v: number) => (Math.max(0, v) / max) * plot;
  const slot = W / points.length;

  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Income and expenses per month (see the table below)">
      <line className="axis" x1={0} x2={W} y1={H - BOTTOM} y2={H - BOTTOM} />
      {points.map((p, i) => {
        const cx = slot * i + slot / 2;
        const dim = hovered !== null && hovered !== p.month;
        const bar = (value: number, x: number, color: string, label: string) => (
          // rx=4 rounds the data end; the bar sits on the baseline.
          <rect x={x} y={H - BOTTOM - height(value)} width={BAR} height={height(value)} rx={4} fill={color} className={dim ? "dimmed" : ""}>
            <title>{`${p.month} ${label}: ${formatMoney(value)}`}</title>
          </rect>
        );
        return (
          // A transparent hit area wider than the bars makes hovering easy.
          <g key={p.month} onMouseEnter={() => setHovered(p.month)} onMouseLeave={() => setHovered(null)}>
            <rect x={slot * i} y={0} width={slot} height={H} fill="transparent" />
            {bar(p.income, cx - BAR - 1, "var(--series-1)", "income")}
            {bar(p.expenses, cx + 1, "var(--series-2)", "expenses")}
            <text x={cx} y={TOP - 10} textAnchor="middle" fontWeight={p.month === current ? 700 : 400}>
              {formatDelta(p.net)}
              {p.awaiting > 0 ? "*" : ""}
            </text>
            <text x={cx} y={H - 6} textAnchor="middle" fontWeight={p.month === current ? 700 : 400}>
              {p.month}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
