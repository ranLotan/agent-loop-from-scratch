import { useOutletContext } from "react-router";

export interface LayoutContext {
  month: string;
}

/** The month chosen in Layout. Only pages rendered inside Layout's <Outlet /> can call this. */
export function useSelectedMonth(): string {
  return useOutletContext<LayoutContext>().month;
}
