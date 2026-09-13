import { useMemo } from 'react';
import { SearchIndex, type SearchNote, type SearchResult } from './SearchIndex';

/**
 * Builds a SearchIndex from notes and returns ranked results for `query`.
 */
export function useSearch(
  query: string,
  notes: SearchNote[],
  limit = 50,
): {
  results: SearchResult[];
  index: SearchIndex;
} {
  const index = useMemo(() => new SearchIndex().build(notes), [notes]);
  const results = useMemo(
    () => index.query(query, limit),
    [index, query, limit],
  );
  return { results, index };
}
