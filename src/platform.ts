/** Labels for keyboard shortcuts; commands themselves accept Cmd or Ctrl. */
export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export function shortcut(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl${key}`;
}

export function shortcutWithShift(key: string): string {
  return isMac ? `⌘⇧${key}` : `Ctrl+Shift+${key}`;
}
