import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { Layout } from "./components/Layout";
import { MonthGate } from "./components/MonthGate";
import { DashboardPage } from "./pages/DashboardPage";
import { ImportsPage } from "./pages/ImportsPage";
import { ManualPage } from "./pages/ManualPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RecurringDefinitionsPage } from "./pages/RecurringDefinitionsPage";
import { ReviewPage } from "./pages/ReviewPage";
import { RulesPage } from "./pages/RulesPage";
import { TransactionsPage } from "./pages/TransactionsPage";

/** The M5 /recurring URL now lives at /manual (M6). Keeps ?month= so old bookmarks land on the same month. */
function RecurringRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/manual", search }} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* Pages that show one month sit inside MonthGate; Imports works even with no months yet. */}
          <Route element={<MonthGate />}>
            <Route index element={<DashboardPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="review" element={<ReviewPage />} />
            <Route path="manual" element={<ManualPage />} />
            <Route path="manual/definitions" element={<RecurringDefinitionsPage />} />
          </Route>
          <Route path="recurring" element={<RecurringRedirect />} />
          <Route path="imports" element={<ImportsPage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
