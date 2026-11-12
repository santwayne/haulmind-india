import { useCallback, useEffect, useState } from 'react';
import { api } from './client';
import type { Branch } from '../redux/store';

// Tiny data hook: GET path with params, refetch on change
export function useGet<T>(path: string | null, params?: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(params || {});
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(JSON.parse(key)).filter(([, v]) => v !== '' && v != null));
      const r = await api.get(path, { params: clean });
      setData(r.data.data);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [path, key]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, loading, error, reload: load };
}

let branchCache: Branch[] | null = null;
export function useBranches() {
  const [list, setList] = useState<Branch[]>(branchCache || []);
  useEffect(() => {
    if (branchCache) return;
    api.get('/branches', { params: { limit: 200 } }).then((r) => {
      branchCache = r.data.data.items;
      setList(branchCache!);
    });
  }, []);
  return list;
}
export const clearBranchCache = () => {
  branchCache = null;
};
