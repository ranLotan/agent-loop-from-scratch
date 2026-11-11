import type { CategorizedTransaction } from "../../../../src/types";

// Record<…> makes TypeScript insist on a label for every source, so a new one can't be forgotten.
const LABELS: Record<NonNullable<CategorizedTransaction["categorySource"]>, string> = {
  manual: "Manual",
  agent: "Agent",
  rule: "Rule",
  cal: "Cal",
};

/** How a transaction got its category. */
export function SourceBadge({ source }: { source: CategorizedTransaction["categorySource"] }) {
  return <span className={`badge badge-${source ?? "none"}`}>{source ? LABELS[source] : "None"}</span>;
}
