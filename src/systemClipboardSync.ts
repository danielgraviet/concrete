/**
 * Push plain text onto the OS pasteboard after copy/cut.
 * Chromium's in-page clipboard can stay local to Electron; terminals need
 * Electron's `clipboard` module for a real macOS pasteboard write.
 */
export function installSystemClipboardSync(): () => void {
  const sync = (event: ClipboardEvent) => {
    const write = window.systemClipboard?.writeText;
    if (!write) return;

    const fromEvent = event.clipboardData?.getData('text/plain') ?? '';
    const fromSelection = window.getSelection()?.toString() ?? '';
    const text = fromEvent || fromSelection;
    if (!text) return;

    void write(text);
  };

  document.addEventListener('copy', sync);
  document.addEventListener('cut', sync);
  return () => {
    document.removeEventListener('copy', sync);
    document.removeEventListener('cut', sync);
  };
}
