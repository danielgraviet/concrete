/**
 * Bounded in-memory note body cache (open note + recent reads).
 * Pinned paths are never evicted — critical so the open note survives
 * bulk warm-index updates that exceed maxEntries.
 */
export class NoteBodyCache {
  #map = new Map<string, string>();
  #pinned = new Set<string>();
  #maxEntries: number;

  constructor(maxEntries = 24) {
    this.#maxEntries = Math.max(4, maxEntries);
  }

  pin(path: string): void {
    if (path) this.#pinned.add(path);
  }

  clearPins(): void {
    this.#pinned.clear();
  }

  get(path: string): string | undefined {
    if (!path || !this.#map.has(path)) return undefined;
    const value = this.#map.get(path);
    // Refresh LRU order.
    this.#map.delete(path);
    this.#map.set(path, value!);
    return value;
  }

  has(path: string): boolean {
    return Boolean(path) && this.#map.has(path);
  }

  set(path: string, body: string): void {
    if (!path) return;
    if (this.#map.has(path)) this.#map.delete(path);
    this.#map.set(path, body);
    this.#evict();
  }

  #evict(): void {
    while (this.#map.size > this.#maxEntries) {
      let victim: string | undefined;
      for (const key of this.#map.keys()) {
        if (!this.#pinned.has(key)) {
          victim = key;
          break;
        }
      }
      // Everything left is pinned — stop rather than dropping the open note.
      if (!victim) break;
      this.#map.delete(victim);
    }
  }

  delete(path: string): void {
    if (path) this.#map.delete(path);
  }

  /** Drop entries under a renamed/deleted folder prefix. */
  deletePrefix(prefix: string): void {
    if (!prefix) return;
    for (const key of [...this.#map.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}/`)) this.#map.delete(key);
    }
  }

  clear(): void {
    this.#map.clear();
  }

  /** Snapshot for React state sync (selected + cached). */
  toRecord(): Record<string, string> {
    return Object.fromEntries(this.#map.entries());
  }

  get size(): number {
    return this.#map.size;
  }
}
