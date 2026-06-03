import { useState, useEffect, useRef } from "react";
import { cogsCategoriesApi } from "../api";
import type { CogsCategory } from "../types";

interface UseCogsCategoriesResult {
  categories: CogsCategory[];
  loading: boolean;
  error: string | null;
  /** Re-trigger a fetch manually (e.g. after creating a new category). */
  refetch: () => void;
}

// Module-level cache so repeated mounts (e.g. multiple modals open/close) don't
// re-fetch.  Cleared when refetch() is called.
let cached: CogsCategory[] | null = null;
let inFlight: Promise<CogsCategory[]> | null = null;

export function useCogsCategories(): UseCogsCategoriesResult {
  const [categories, setCategories] = useState<CogsCategory[]>(cached ?? []);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  function load() {
    if (cached !== null) {
      setCategories(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    if (!inFlight) {
      inFlight = cogsCategoriesApi.list().finally(() => { inFlight = null; });
    }

    inFlight
      .then((data) => {
        cached = data;
        if (mountedRef.current) {
          setCategories(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        const status: number | undefined = err?.response?.status;
        let message: string;
        if (!err?.response) {
          message = "Failed to fetch COGS categories";
        } else if (status === 401) {
          message = "Not authenticated";
        } else if (status === 400 || status === 404) {
          message = err.response.data?.error?.message ?? err.response.data?.error ?? "Invalid request";
        } else if (status && status >= 500) {
          message = "Server error";
        } else {
          message = err.response.data?.error?.message ?? err.response.data?.error ?? "Failed to fetch COGS categories";
        }
        setError(message);
        setLoading(false);
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  function refetch() {
    cached = null;
    inFlight = null;
    load();
  }

  return { categories, loading, error, refetch };
}
