import { useMemo, useSyncExternalStore } from 'react';
import type { SearchIndex, SearchResult } from './SearchIndex';

/**
 * Ranked results for `query` from a live SearchIndex; re-queries whenever
 * the index changes (notes added, edited, or removed).
 */
export function useSearch(index: SearchIndex, query: string, limit = 50): SearchResult[] {
  const version = useSyncExternalStore(index.subscribe, index.getVersion);
  return useMemo(
    () => index.query(query, limit),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version tracks index contents
    [index, version, query, limit],
  );
}
