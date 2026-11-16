import { useState } from "react";
import { useSearchParams } from "react-router";
import { api, type CalRuleRow, type CategoryRow, type LedgerSummary, type RuleRow } from "../api";
import { formatMoney } from "../format";
import { useApi } from "../hooks/useApi";

/** Runs a change, then reloads the page's data; shows the error if the server refused it. */
function useMutation(onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    work()
      .then(onDone)
      .catch((err) => setError((err as Error).message))
      .finally(() => setBusy(false));
  }
  return { run, error, busy };
}

const SECTIONS = { categories: true, rules: false, calRules: false } as const; // id → open by default
type SectionId = keyof typeof SECTIONS;
const STORAGE_KEY = "rules.openSections";

/**
 * Which sections are open, remembered per browser. localStorage can be missing or throw (private window,
 * blocked site data), so every access is wrapped: the page then just starts with the defaults.
 */
function useOpenSections() {
  const [open, setOpen] = useState<Record<SectionId, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Record<SectionId, unknown>>;
      return Object.fromEntries(
        Object.entries(SECTIONS).map(([id, byDefault]) => [id, typeof saved[id as SectionId] === "boolean" ? saved[id as SectionId] : byDefault]),
      ) as Record<SectionId, boolean>;
    } catch {
      return { ...SECTIONS };
    }
  });
  function update(next: Record<SectionId, boolean>) {
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not remembered this time; the page works the same.
    }
  }
  const setOne = (id: SectionId, value: boolean) => open[id] !== value && update({ ...open, [id]: value });
  const setAll = (value: boolean) => update(Object.fromEntries(Object.keys(SECTIONS).map((id) => [id, value])) as Record<SectionId, boolean>);
  return { open, setOne, setAll };
}

export function RulesPage() {
  // One key for every list: renaming a category changes how the rules list reads, too.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const categories = useApi(() => api.categories(), [reloadKey]);
  const rules = useApi(() => api.rules(), [reloadKey]);
  const calRules = useApi(() => api.calRules(), [reloadKey]);
  const sections = useOpenSections();

  // This page sits outside MonthGate, so it picks its month itself: the URL's, or the latest imported one.
  const [searchParams] = useSearchParams();
  const months = useApi(() => api.months(), []);
  const month = searchParams.get("month") || months.data?.at(-1) || null;
  const ledger = useApi(() => (month ? api.ledger(month) : Promise.resolve(null)), [month, reloadKey]);

  const capped = categories.data?.filter((c) => c.cap !== null).length ?? 0;
  const capable = categories.data?.filter((c) => !c.system).length ?? 0;

  return (
    <section>
      <div className="page-head">
        <h1>Rules and categories</h1>
        <div className="actions">
          <button type="button" onClick={() => sections.setAll(true)}>
            Expand all
          </button>
          <button type="button" onClick={() => sections.setAll(false)}>
            Collapse all
          </button>
        </div>
      </div>
      <p className="muted">
        A rule gives every charge from a merchant its category, in every month. An edit on one transaction beats its rule.
      </p>

      <Section
        title="Categories & monthly caps"
        meta={categories.data ? `${capped} of ${capable} capped` : undefined}
        open={sections.open.categories}
        onToggle={(value) => sections.setOne("categories", value)}
      >
        {categories.error && <p role="alert">Error: {categories.error}</p>}
        {categories.data && (
          <CategoriesTable categories={categories.data} month={month} summary={ledger.data?.summary ?? null} onChanged={reload} />
        )}
      </Section>

      <Section
        title="Merchant rules"
        meta={rules.data ? `${rules.data.length} merchant → category` : undefined}
        open={sections.open.rules}
        onToggle={(value) => sections.setOne("rules", value)}
      >
        {rules.error && <p role="alert">Error: {rules.error}</p>}
        {rules.data && categories.data && <RulesTable rules={rules.data} categories={categories.data} onChanged={reload} />}
      </Section>

      <Section
        title="Cal rules"
        meta={calRules.data ? `${calRules.data.filter((r) => r.category === null).length} sector(s) not mapped` : undefined}
        open={sections.open.calRules}
        onToggle={(value) => sections.setOne("calRules", value)}
      >
        <p className="muted">
          Map each Cal sector (ענף) to one of your categories. Used when a merchant has no rule. A sector that isn't mapped
          leaves its charges uncategorized, so the agent reviews them.
        </p>
        {calRules.error && <p role="alert">Error: {calRules.error}</p>}
        {calRules.data && categories.data && (
          <CalRulesTable calRules={calRules.data} categories={categories.data} onChanged={reload} />
        )}
      </Section>
    </section>
  );
}

/**
 * A native <details>, controlled from the parent so "Expand all" can open every section. React's `open` prop
 * sets the attribute; `onToggle` reports both a click and our own change, so the state stays the one source
 * of truth (in Angular terms: [open] + (toggle), a two-way binding written out by hand).
 */
function Section(props: { title: string; meta?: string; open: boolean; onToggle: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <details className="accordion" open={props.open} onToggle={(e) => props.onToggle(e.currentTarget.open)}>
      <summary>
        <span className="chevron" aria-hidden>
          ▶
        </span>
        <span className="accordion-title">{props.title}</span>
        {props.meta && <span className="accordion-meta">{props.meta}</span>}
      </summary>
      <div className="accordion-body">{props.children}</div>
    </details>
  );
}

const CREATED_FROM = { seed: "Imported", approve: "Approved proposal", manual: "Added by you" } as const;

function RulesTable({ rules, categories, onChanged }: { rules: RuleRow[]; categories: CategoryRow[]; onChanged: () => void }) {
  const { run, error, busy } = useMutation(onChanged);
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("");
  const names = categories.map((c) => c.name);

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    run(() => api.addRule(merchant, category).then(() => setMerchant("")));
  }

  return (
    <>
      <form onSubmit={add}>
        <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Merchant, as the bank writes it" dir="auto" />
        <CategorySelect names={names} value={category} onChange={setCategory} placeholder="Category…" />
        <button type="submit" disabled={busy || !merchant.trim() || !category}>
          Add rule
        </button>
      </form>
      {error && <p role="alert">Error: {error}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Merchant</th>
            <th>Category</th>
            <th>Added</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td dir="auto">{r.merchant}</td>
              <td>
                <CategorySelect names={names} value={r.category} onChange={(next) => run(() => api.updateRule(r.id, next))} />
              </td>
              <td className="muted">{CREATED_FROM[r.createdFrom]}</td>
              <td>
                <button type="button" className="link-button" disabled={busy} onClick={() => run(() => api.deleteRule(r.id))}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rules.length && <p className="muted">No rules yet.</p>}
    </>
  );
}

function CalRulesTable(props: { calRules: CalRuleRow[]; categories: CategoryRow[]; onChanged: () => void }) {
  const { run, error, busy } = useMutation(props.onChanged);
  const names = props.categories.map((c) => c.name);
  const unmapped = props.calRules.filter((r) => r.category === null).length;

  return (
    <>
      {error && <p role="alert">Error: {error}</p>}
      {unmapped > 0 && <p className="muted">{unmapped} sector(s) not mapped yet.</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Cal sector</th>
            <th className="num">Charges</th>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          {props.calRules.map((r) => (
            <tr key={r.sector}>
              <td dir="auto">{r.sector}</td>
              <td className="num">{r.count}</td>
              <td>
                {/* "" = not mapped: the select is controlled, like [(ngModel)], and saves on change. */}
                <CategorySelect
                  names={names}
                  value={r.category ?? ""}
                  placeholder="— not mapped —"
                  disabled={busy}
                  onChange={(next) => run(() => api.setCalRule(r.sector, next || null))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!props.calRules.length && <p className="muted">No Cal sectors yet: import a statement first.</p>}
    </>
  );
}

/** What's typed in a cap input → the cap to save. "" = no cap; "1,000" is fine; anything else isn't a cap. */
function parseCap(text: string): number | null | "invalid" {
  const clean = text.replace(/[,\s₪]/g, "");
  if (clean === "") return null;
  const value = Number(clean);
  return Number.isFinite(value) && value > 0 ? value : "invalid";
}

function CategoriesTable(props: {
  categories: CategoryRow[];
  /** The month "This month" means; null while the months are loading or none are imported. */
  month: string | null;
  summary: LedgerSummary | null;
  onChanged: () => void;
}) {
  const { categories, month, summary } = props;
  // Typed but not saved yet, by category id. Rows without an entry show their saved cap. This is a plain map
  // in state rather than a form library: Angular would use a FormArray, React just renders from the map.
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const { run, error, busy } = useMutation(() => {
    setDrafts({});
    props.onChanged();
  });
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    run(() => api.addCategory(newName).then(() => setNewName("")));
  }
  function rename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (renaming) run(() => api.renameCategory(renaming.id, renaming.name).then(() => setRenaming(null)));
  }

  const capText = (c: CategoryRow) => drafts[c.id] ?? (c.cap === null ? "" : String(c.cap));
  // Derived on every render: which rows differ from what's saved, and whether any of them can't be saved.
  const changed = categories.flatMap((c) => {
    if (drafts[c.id] === undefined) return [];
    const cap = parseCap(drafts[c.id]);
    return cap === c.cap ? [] : [{ id: c.id, name: c.name, cap }];
  });
  const invalid = changed.filter((c) => c.cap === "invalid");
  function saveCaps() {
    if (busy || invalid.length || !changed.length) return;
    run(() => api.setCaps(changed.map((c) => ({ id: c.id, cap: c.cap as number | null }))));
  }

  const usage = new Map(summary?.caps.usage.map((u) => [u.category, u]));
  const spent = new Map(summary?.byCategory.map((c) => [c.category, c.amount]));
  // Capped first, then by this month's spending: the rows I'm watching are on top.
  const rows = [...categories].sort(
    (a, b) => Number(b.cap !== null) - Number(a.cap !== null) || (spent.get(b.name) ?? 0) - (spent.get(a.name) ?? 0) || a.id - b.id,
  );

  return (
    <>
      <p className="muted">Leave the cap empty for no cap. Caps are per month, in ₪, and count the month's expenses by purchase month.</p>
      {error && <p role="alert">Error: {error}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Monthly cap</th>
            <th>This month{month ? ` (${month})` : ""}</th>
            <th>Used by</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const inUse = c.rules + c.calRules + c.edits > 0;
            const locked = c.system || inUse;
            const u = usage.get(c.name);
            const draft = drafts[c.id];
            const bad = draft !== undefined && parseCap(draft) === "invalid";
            return (
              <tr key={c.id}>
                {/* dir="auto": a Hebrew name sits on the right, an English one on the left (the first letter decides). */}
                <td dir="auto">
                  {renaming?.id === c.id ? (
                    <form onSubmit={rename}>
                      <input
                        value={renaming.name}
                        onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                        dir="auto"
                        autoFocus
                      />
                      <button type="submit" disabled={busy || !renaming.name.trim()}>
                        Save
                      </button>
                      <button type="button" onClick={() => setRenaming(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      {c.name}
                      {c.system && <div className="sub">built in: charges that wait for you</div>}
                    </>
                  )}
                </td>
                <td>
                  {c.system ? (
                    <span className="muted">—</span>
                  ) : (
                    // A <label> around the input: the ₪ sign is part of what a screen reader announces.
                    <label className="cap-input">
                      <span aria-hidden>₪</span>
                      <input
                        inputMode="decimal"
                        value={capText(c)}
                        placeholder="No cap"
                        aria-label={`Monthly cap for ${c.name}`}
                        aria-invalid={bad || undefined}
                        dir="ltr"
                        onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && saveCaps()}
                      />
                    </label>
                  )}
                  {bad && <div className="sub bad">A number above 0, or empty</div>}
                </td>
                <td>
                  {u ? (
                    <span className={u.over ? "bad" : "good"}>
                      {formatMoney(u.spent)} · {u.over ? `${formatMoney(-u.remaining)} over` : `${formatMoney(u.remaining)} left`}
                    </span>
                  ) : (
                    <span className="muted">{formatMoney(spent.get(c.name) ?? 0)}</span>
                  )}
                </td>
                <td className="sub">{usedBy(c)}</td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    disabled={c.system}
                    title={c.system ? "Built in: a rule to it keeps a merchant away from the agent" : undefined}
                    onClick={() => setRenaming({ id: c.id, name: c.name })}
                  >
                    Rename
                  </button>{" "}
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy || locked}
                    title={c.system ? "Built in" : inUse ? "In use: change its rules and edits first" : undefined}
                    onClick={() => run(() => api.deleteCategory(c.id))}
                  >
                    Delete
                  </button>
                  {capText(c) !== "" && (
                    <>
                      {" "}
                      {/* Clears the input; Save caps removes it. */}
                      <button type="button" className="link-button" onClick={() => setDrafts({ ...drafts, [c.id]: "" })}>
                        Remove cap
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="actions">
        <button type="button" className="primary" disabled={busy || !changed.length || invalid.length > 0} onClick={saveCaps}>
          Save caps{changed.length ? ` (${changed.length})` : ""}
        </button>
        {changed.length > 0 && (
          <button type="button" disabled={busy} onClick={() => setDrafts({})}>
            Discard changes
          </button>
        )}
        <form onSubmit={add}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category" dir="auto" />
          <button type="submit" disabled={busy || !newName.trim()}>
            + New category
          </button>
        </form>
      </div>
    </>
  );
}

/** "3 rules · 1 Cal rule · 2 edits", or "—": why a category can't be deleted. */
function usedBy(c: CategoryRow): string {
  const parts = [
    c.rules && `${c.rules} rule${c.rules === 1 ? "" : "s"}`,
    c.calRules && `${c.calRules} Cal rule${c.calRules === 1 ? "" : "s"}`,
    c.edits && `${c.edits} edit${c.edits === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function CategorySelect(props: {
  names: string[];
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)} dir="auto" disabled={props.disabled}>
      {props.placeholder && <option value="">{props.placeholder}</option>}
      {props.names.map((name) => (
        <option key={name} value={name} dir="auto">
          {name}
        </option>
      ))}
    </select>
  );
}
