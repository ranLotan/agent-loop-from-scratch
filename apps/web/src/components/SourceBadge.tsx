import type { CategorizedTransaction } from "../../../../src/types";

const LABELS = { rule: "Rule", cal: "Cal" } as const;

/** How a transaction got its category. */
export function SourceBadge({ source }: { source: CategorizedTransaction["categorySource"] }) {
  return <span className={`badge badge-${source ?? "none"}`}>{source ? LABELS[source] : "None"}</span>;
}
