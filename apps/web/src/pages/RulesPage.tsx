import { useState } from "react";
import { api, type CategoryRow, type RuleRow } from "../api";
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

export function RulesPage() {
  // One key for both lists: renaming a category changes how the rules list reads, too.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const categories = useApi(() => api.categories(), [reloadKey]);
  const rules = useApi(() => api.rules(), [reloadKey]);

  return (
    <section>
      <h1>Rules and categories</h1>
      <p className="muted">
        A rule gives every charge from a merchant its category, in every month. An edit on one transaction beats its rule.
      </p>

      <h2>Rules</h2>
      {rules.error && <p role="alert">Error: {rules.error}</p>}
      {rules.data && categories.data && <RulesTable rules={rules.data} categories={categories.data} onChanged={reload} />}

      <h2>Categories</h2>
      {categories.error && <p role="alert">Error: {categories.error}</p>}
      {categories.data && <CategoriesTable categories={categories.data} onChanged={reload} />}
    </section>
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

function CategoriesTable({ categories, onChanged }: { categories: CategoryRow[]; onChanged: () => void }) {
  const { run, error, busy } = useMutation(onChanged);
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

  return (
    <>
      <form onSubmit={add}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category" dir="auto" />
        <button type="submit" disabled={busy || !newName.trim()}>
          Add category
        </button>
      </form>
      {error && <p role="alert">Error: {error}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Category</th>
            <th className="num">Rules</th>
            <th className="num">Edited transactions</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => {
            const inUse = c.rules + c.edits > 0;
            const locked = c.system || inUse;
            return (
              <tr key={c.id}>
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
                      {c.system && <span className="sub"> built in: charges that wait for you</span>}
                    </>
                  )}
                </td>
                <td className="num">{c.rules}</td>
                <td className="num">{c.edits}</td>
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function CategorySelect(props: { names: string[]; value: string; onChange: (name: string) => void; placeholder?: string }) {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)} dir="auto">
      {props.placeholder && <option value="">{props.placeholder}</option>}
      {props.names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}
