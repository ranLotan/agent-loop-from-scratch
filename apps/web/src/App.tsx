import { BrowserRouter, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { MonthGate } from "./components/MonthGate";
import { DashboardPage } from "./pages/DashboardPage";
import { ImportsPage } from "./pages/ImportsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { TransactionsPage } from "./pages/TransactionsPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* Pages that show one month sit inside MonthGate; Imports works even with no months yet. */}
          <Route element={<MonthGate />}>
            <Route index element={<DashboardPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
          </Route>
          <Route path="imports" element={<ImportsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
