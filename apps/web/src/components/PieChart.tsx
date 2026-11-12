import type { PieSlice } from "../api";

/** Colors by position: slices come biggest first from the server, and "Other" (if any) is always last and gray. */
export const sliceColor = (slice: PieSlice, index: number) => (slice.grouped ? "var(--series-other)" : `var(--series-${index + 1})`);

interface PieChartProps {
  slices: PieSlice[];
  /** The slice under the pointer, shared with the legend so both highlight together (state lives in the parent). */
  hovered: number | null;
  onHover: (index: number | null) => void;
  /** Click handler, or null for slices that can't open anything (Other, manual-only categories). */
  onSelect: (slice: PieSlice) => (() => void) | null;
}

const R = 100;

/** A point on the circle, `fraction` of the way round, clockwise from 12 o'clock. */
function point(fraction: number): [number, number] {
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  return [R + R * Math.cos(angle), R + R * Math.sin(angle)];
}

/**
 * One SVG arc path per slice, derived from props on every render: no state, no effect. In Angular this would be
 * a pure pipe or a computed getter; in React it's just code in the function body.
 */
export function PieChart({ slices, hovered, onHover, onSelect }: PieChartProps) {
  // Running start positions. Percentages (already rounded by the core to add up to 100) only turn into geometry here.
  let start = 0;
  const arcs = slices.map((slice, i) => {
    const from = start;
    start += slice.percent / 100;
    return { slice, i, from, to: start };
  });

  return (
    <svg className="pie" viewBox={`0 0 ${2 * R} ${2 * R}`} role="img" aria-label="Expenses by category (the table next to it has the numbers)">
      {arcs.map(({ slice, i, from, to }) => {
        const select = onSelect(slice);
        const props = {
          fill: sliceColor(slice, i),
          className: [select ? "clickable" : "", hovered !== null && hovered !== i ? "dimmed" : ""].join(" "),
          onMouseEnter: () => onHover(i),
          onMouseLeave: () => onHover(null),
          onClick: select ?? undefined,
        };
        const title = <title>{`${slice.category}: ${slice.percent}%`}</title>;
        // A full circle can't be drawn as one arc (start and end are the same point).
        if (to - from >= 0.9999) return <circle key={slice.category} cx={R} cy={R} r={R} {...props}>{title}</circle>;
        const [x0, y0] = point(from);
        const [x1, y1] = point(to);
        const largeArc = to - from > 0.5 ? 1 : 0;
        return (
          <path key={slice.category} d={`M ${R} ${R} L ${x0} ${y0} A ${R} ${R} 0 ${largeArc} 1 ${x1} ${y1} Z`} {...props}>
            {title}
          </path>
        );
      })}
    </svg>
  );
}
