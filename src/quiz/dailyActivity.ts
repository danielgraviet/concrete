/** Local, vault-scoped days when the user actively used the app. */
export class DailyActivityStore {
  private readonly key: string;
  private days: string[] = [];

  constructor(vaultRoot = '') {
    this.key = `mv:daily-activity:${vaultRoot || '__default__'}`;
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(this.key) || '[]');
      if (Array.isArray(parsed)) this.days = parsed.filter((day): day is string => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day));
    } catch {
      this.days = [];
    }
  }

  getDays(): string[] { return [...this.days]; }

  mergeDays(days: string[]): void {
    const merged = new Set(this.days);
    for (const day of days) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) merged.add(day);
    }
    if (merged.size === this.days.length) return;
    this.days = [...merged].sort();
    try { localStorage.setItem(this.key, JSON.stringify(this.days)); } catch { /* Activity is optional if storage is unavailable. */ }
    for (const listener of this.listeners) listener();
  }

  recordToday(now = new Date()): void {
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (this.days.includes(key)) return;
    this.days.push(key);
    try { localStorage.setItem(this.key, JSON.stringify(this.days)); } catch { /* Activity is optional if storage is unavailable. */ }
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private listeners = new Set<() => void>();
}
