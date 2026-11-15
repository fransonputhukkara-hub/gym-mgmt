import { useCallback, useEffect, useState } from 'react';
import { api, AuthError } from './api';

/** Fetches on mount, when the path changes, and every `refreshMs`. Reports auth failure via onAuth. */
export function useApi<T>(path: string, onAuth: () => void, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setData(await api<T>(path)); setError(''); }
    catch (e) { if (e instanceof AuthError) onAuth(); else setError((e as Error).message); }
  }, [path, onAuth]);
  useEffect(() => {
    void load();
    if (!refreshMs) return;
    const t = setInterval(() => void load(), refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);
  return { data, error, reload: load };
}
