import type { ReactNode } from "react";

/** A labeled figure. Whatever goes between <Stat> tags arrives as `children`, like ng-content. */
export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{children}</div>
    </div>
  );
}
