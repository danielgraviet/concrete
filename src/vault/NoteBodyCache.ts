/**
 * Bounded in-memory note body cache (open tabs + recent reads).
 * Prevents holding an entire vault's markdown in React state.
 */
export class NoteBodyCache {
  #map = new Map<string, string>();
  #maxEntries: number;

  constructor(maxEntries = 24) {
    this.#maxEntries = Math.max(4, maxEntries);
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
    while (this.#map.size > this.#maxEntries) {
      const oldest = this.#map.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#map.delete(oldest);
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
