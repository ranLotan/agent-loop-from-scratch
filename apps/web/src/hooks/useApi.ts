// M1, YOUR PART: the useApi hook.
//
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
  // TODO 1: keep the three values in state. For example:
   const [data, setData] = useState<T | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [loading, setLoading] = useState<boolean>(true);
  //   ...the same for error (string | null) and loading (boolean, starts true).

  // TODO 2: call useEffect(() => { ... }, deps). Inside the effect:
  useEffect(() => {
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
