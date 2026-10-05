/** Max notes open at once (issue #20). */
export const MAX_OPEN_TABS = 5;

/** Open a note in the tab list (append if new). Caps at `max` by dropping the oldest. */
export function openNoteInTabs(tabs: string[], path: string, max = MAX_OPEN_TABS): string[] {
  if (!path) return tabs;
  if (tabs.includes(path)) return tabs;
  const next = [...tabs, path];
  return next.length <= max ? next : next.slice(next.length - max);
}

/** Select a temporary preview, replacing the previous preview tab if present. */
export function previewNoteInTabs(tabs: string[], preview: string | null, path: string, max = MAX_OPEN_TABS): string[] {
  if (!path || (tabs.includes(path) && path !== preview)) return tabs;
  const next = [...(preview ? tabs.filter((tab) => tab !== preview) : tabs), path];
  return next.length <= max ? next : next.slice(next.length - max);
}

/** Remove a note from the open tab list. */
export function closeNoteTab(tabs: string[], path: string): string[] {
  return tabs.filter((tab) => tab !== path);
}

/** Which tab to activate after closing `path` (neighbor, else previous, else first). */
export function tabAfterClose(tabs: string[], path: string): string | null {
  const index = tabs.indexOf(path);
  if (index < 0) return tabs[0] ?? null;
  const remaining = closeNoteTab(tabs, path);
  if (remaining.length === 0) return null;
  return remaining[Math.min(index, remaining.length - 1)] ?? remaining[0] ?? null;
}

/** Rewrite tab paths after a rename (file or folder prefix). */
export function renamePathsInTabs(tabs: string[], from: string, to: string): string[] {
  if (!from || !to || from === to) return tabs;
  return tabs.map((tab) => {
    if (tab === from) return to;
    if (tab.startsWith(`${from}/`)) return `${to}${tab.slice(from.length)}`;
    return tab;
  });
}
