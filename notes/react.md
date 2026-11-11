---
study: true
chapter: React
---
# React: interview cheat sheet

Built lesson by lesson while working on cal-expense-agent (a local React + Express + SQLite dashboard).
Each lesson has key points, then interview questions with the answers we settled on.

---

## Lesson 1: Forms, URL state and server data

**Key points**
- **Controlled vs uncontrolled inputs:** controlled = `value` from React state + `onChange`, so React is the single source of truth. Uncontrolled = the DOM keeps the value and you read it when needed (a ref, the event, `FormData`).
  - Controlled is the default for forms: validation, disabling a button or resetting is just state. A file input is always uncontrolled.
- **Where state lives:** as close as possible to where it's used (local `useState`). Lift it to the nearest common parent when siblings need it. Put it in the URL when it should survive a refresh, be bookmarkable or shareable, or work with Back (filters, the selected month, the tab).
  - Use `replace` for keystroke-level changes so Back isn't one entry per letter.
- **Derived state:** if it can be computed from props or state (a filtered list, a total), compute it during render. Storing it in `useState` creates two sources of truth.
- **`key`:** tells React which element is which between renders, both for list rows and for component identity. A new `key` remounts the component with fresh state, which is the idiomatic way to reset a form for a different record. Use stable ids, not array indexes.
- **Keeping the UI in sync after a write:** refetch (invalidate) is simple and always correct. An optimistic update is instant but needs rollback, and often duplicates server logic.
- **Don't unmount inputs while loading:** if a spinner replaces the page, a text box loses focus on every keystroke. Keep the controls rendered and show the previous results until new ones arrive.
- **HTTP status codes for domain errors:** 400 bad input, 404 unknown id, 409 conflict with existing data, 500 only for real bugs. Map typed errors in one place.
- **In this project:** `EditTransactionForm.tsx` (a controlled form, reset with `key={editing.id}`), filters in the URL in `TransactionsPage.tsx` (`useSearchParams` + `replace`), a `reloadKey` in `useApi` deps for refetching after a save, the file input in `ImportsPage.tsx`, and `ValidationError` / `NotFoundError` / `ConflictError` → 400/404/409 in `apps/api/src/app.ts`. "Make it a rule" recategorized 67 charges across months, which is a server-computed result, so the page refetches.

**Interview questions**
1. What's the difference between a controlled and an uncontrolled input in React, and when would you use an uncontrolled one?
   - *Answer:* A controlled input takes its value from React state and updates that state in `onChange`, so React is the single source of truth, and validation, disabling a button or resetting the form is just state.
     An uncontrolled input keeps its own value in the DOM, and I read it when I need it: through a ref, the event, or `FormData` on submit.
     I use uncontrolled when I can't control it (a file input), for simple submit-only forms, or when wrapping a non-React widget.
   - ⚠️ Don't switch between them: `value={undefined}` and then a string triggers "changing an uncontrolled input to be controlled". Start with `""`.
2. Where should a list's filter and search state live: component state or the URL? What are the trade-offs?
   - *Answer:* Filters belong in the URL: they survive a refresh, can be bookmarked and shared, and Back and Forward work.
     Component state is better for short-lived UI state like an open menu, the row being edited, or a draft, and the URL is wrong for anything sensitive or large.
     The costs: URL values are strings I have to parse and validate, and updates add history entries, so I use `replace` while typing and debounce if each change triggers an expensive request.
   - ⚠️ Rule of thumb: if the user would expect a link to reopen the same view, it goes in the URL.
3. What does the `key` prop do in React, and how can you use it to reset a component's state?
   - *Answer:* `key` tells React which element is which between renders. In a list it matches rows by key so it updates, moves or removes the right ones, which is why keys must be stable ids, not array indexes.
     A key also defines a component's identity: if it changes, React unmounts the old component and mounts a fresh one with new state.
     So to reset a form when it starts editing a different record, I give it `key={record.id}` instead of writing effects that copy props into state.
   - ⚠️ The anti-pattern it replaces: a `useEffect` that copies props into state when an id changes. It runs one render late and is easy to get wrong.
4. After the user saves a change, how do you keep the UI in sync with the server? Compare refetching with an optimistic update.
   - *Answer:* Refetching after a save is simpler and always correct: the UI shows what the server actually stored, including side effects, at the cost of a round trip.
     An optimistic update changes the UI immediately and rolls back if the request fails. It feels instant, but needs rollback handling and often means predicting the server's logic in the client.
     I use optimistic updates for small, predictable actions like toggles. When the server computes the outcome, like a rule recategorizing every matching transaction, I refetch or invalidate the affected data.
   - ⚠️ TanStack Query supports both: `invalidateQueries` after a mutation, or `onMutate` with a rollback for optimistic updates.
5. Your API's domain layer can fail because input is invalid, a record doesn't exist, or a change conflicts with existing data. Which HTTP status codes do you return, and how do you map them cleanly?
   - *Answer:* 400 for invalid input, 404 when the record doesn't exist, 409 when the change conflicts with existing data, like a duplicate name or deleting something still in use.
     The domain layer throws typed errors, and one error-handling middleware maps each type to its status code with a consistent JSON body.
     Any error it doesn't recognize is a real bug, so it becomes a 500 and is logged, with no internals in the response.
   - ⚠️ "400 or 422?" Some APIs use 422 for a well-formed request that fails a business rule; either is fine if consistent. Here 422 means an unreadable uploaded file.

---
