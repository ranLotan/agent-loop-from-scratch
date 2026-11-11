// A custom hook is a plain function whose name starts with "use" and which calls other hooks.
// Usage:  const { data, error, loading } = useApi(() => api.summary(month), [month]);
//
// `deps` works like useEffect's array: when a value in it changes, the request runs again.

import { useEffect, useState, type DependencyList } from "react";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useApi<T>(fn: () => Promise<T>, deps: DependencyList): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // Each run gets its own flag; the cleanup sets it when deps change, so a late, stale response is ignored.
    let ignore = false;
    setError(null);
    setLoading(true);
    fn()
      .then((result) => {
        !ignore && setData(result);
      })
      .catch((err) => {
        !ignore && setError((err as Error).message);
      })
      .finally(() => {
        !ignore && setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, deps);
  return { data, error, loading };
}
