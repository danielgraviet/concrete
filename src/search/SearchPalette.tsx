import { useDeferredValue, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FileTextIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { noteTitle } from '../vault/fileTree';
import type { SearchIndex, SearchMatchField, SearchResult } from './SearchIndex';
import { highlightSegments, lineSnippet } from './snippets';
import { useSearch } from './useSearch';

const RESULT_LIMIT = 50;
/** Body snippets are read from disk lazily, only for the top results. */
const SNIPPET_PREFETCH = 20;
const LISTBOX_ID = 'search-palette-results';

const FIELD_LABEL: Record<SearchMatchField, string> = {
  title: 'Title',
  heading: 'Heading',
  body: 'Content',
};

type PaletteItem = {
  path: string;
  title: string;
  result?: SearchResult;
};

type SearchPaletteProps = {
  index: SearchIndex;
  /** Shown before the user types. */
  recentPaths: string[];
  readNote: (path: string) => Promise<string>;
  onOpen: (path: string, result?: SearchResult) => void;
  onClose: () => void;
};

const snippetKey = (result: SearchResult) => `${result.path}:${result.line}`;
/** Vault-relative path without the extension; disambiguates notes whose H1 differs from the file. */
const displayPath = (path: string) => path.replace(/\.md$/i, '');

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightSegments(text, terms).map((segment, i) =>
        segment.match ? <mark key={i}>{segment.text}</mark> : segment.text,
      )}
    </>
  );
}

/** ⌘P quick search across every note in the vault. */
export function SearchPalette({ index, recentPaths, readNote, onOpen, onClose }: SearchPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [snippets, setSnippets] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLUListElement>(null);
  const readNoteRef = useRef(readNote);
  readNoteRef.current = readNote;

  const deferredQuery = useDeferredValue(query);
  const results = useSearch(index, deferredQuery, RESULT_LIMIT);
  const searching = deferredQuery.trim().length > 0;
  const items: PaletteItem[] = searching
    ? results.map((result) => ({ path: result.path, title: result.title, result }))
    : recentPaths.map((path) => ({ path, title: noteTitle(path) }));
  const activeIndex = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => setActive(0), [deferredQuery]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    const pending = results
      .slice(0, SNIPPET_PREFETCH)
      .filter((r) => r.field === 'body' && r.line !== undefined && !(snippetKey(r) in snippets));
    if (pending.length === 0) return undefined;
    let cancelled = false;
    void Promise.all(
      pending.map(async (result) => {
        try {
          return [snippetKey(result), lineSnippet(await readNoteRef.current(result.path), result.line!, result.matches)] as const;
        } catch {
          return [snippetKey(result), ''] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setSnippets((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
  }, [results, snippets]);

  const open = (item: PaletteItem | undefined) => {
    if (item) onOpen(item.path, item.result);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const toggleShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p';
    if (event.key === 'Escape' || toggleShortcut) {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      open(items[activeIndex]);
    }
  };

  const snippetFor = (result: SearchResult) =>
    result.field === 'body' ? snippets[snippetKey(result)] : result.field === 'heading' ? result.snippet : undefined;

  return (
    <div
      className="mv-overlay search-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="search-palette" role="dialog" aria-modal="true" aria-label="Search notes">
        <div className="search-palette-input">
          <MagnifyingGlassIcon width={16} height={16} />
          <input
            autoFocus
            value={query}
            placeholder="Search notes"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={items.length ? `${LISTBOX_ID}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>

        {items.length > 0 ? (
          <>
            {!searching ? <div className="search-palette-section">Open tabs</div> : null}
            <ul className="search-palette-results" id={LISTBOX_ID} role="listbox" ref={listRef}>
              {items.map((item, i) => {
                const result = item.result;
                const snippet = result ? snippetFor(result) : undefined;
                return (
                  <li
                    key={item.path}
                    id={`${LISTBOX_ID}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={`search-palette-result${i === activeIndex ? ' active' : ''}`}
                    onMouseMove={() => {
                      if (i !== activeIndex) setActive(i);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => open(item)}
                  >
                    <FileTextIcon width={14} height={14} className="search-palette-icon" />
                    <div className="search-palette-text">
                      <div className="search-palette-title">
                        <span>
                          <Highlighted text={item.title} terms={result?.matches ?? []} />
                        </span>
                        <span className="search-palette-path">{displayPath(item.path)}</span>
                      </div>
                      {snippet ? (
                        <div className="search-palette-snippet">
                          <Highlighted text={snippet} terms={result?.matches ?? []} />
                        </div>
                      ) : null}
                    </div>
                    {result ? <span className="search-palette-field">{FIELD_LABEL[result.field]}</span> : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="search-palette-empty">{searching ? `No notes match “${deferredQuery.trim()}”` : 'Type to search your vault'}</div>
        )}

        <div className="search-palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
