// Which color each category gets in the "Spending by category" chart (M7). Pure; tested in chart-colors.test.ts.

/** The palette's categorical slots (index.css --series-1..7). A category past them is gray, never a made-up hue. */
export const PALETTE_SIZE = 7;
export const OTHER_COLOR = "var(--series-other)";

/**
 * A category keeps the color it has in the selected month's pie (so the two charts agree). Categories that aren't
 * in that pie take the free slots in name order. Colors depend on the period's category list, never on which
 * categories are selected: removing a chip must not repaint the bars that stay.
 */
export function categoryColors(pie: { category: string; grouped?: string[] }[], categories: string[]): Map<string, string> {
  const colors = new Map<string, string>();
  const used = new Set<number>();
  pie.forEach((slice, i) => {
    if (slice.grouped || i >= PALETTE_SIZE) return;
    colors.set(slice.category, `var(--series-${i + 1})`);
    used.add(i + 1);
  });
  const free = Array.from({ length: PALETTE_SIZE }, (_, i) => i + 1).filter((slot) => !used.has(slot));
  for (const category of [...categories].sort((a, b) => a.localeCompare(b))) {
    if (colors.has(category)) continue;
    const slot = free.shift();
    colors.set(category, slot === undefined ? OTHER_COLOR : `var(--series-${slot})`);
  }
  return colors;
}
