/** Per-user file storage accounting (bytes stored in R2), kept in D1. */

export interface StorageInfo {
  usedBytes: number;
  limitBytes: number;
}

export interface ReserveBytesResult {
  ok: boolean;
  usedBytes: number;
}

export interface StorageStore {
  getUsed(uid: string): Promise<number>;
  /** Atomically adds `bytes` (> 0) when the total stays within `limit`. */
  reserve(uid: string, bytes: number, limit: number): Promise<ReserveBytesResult>;
  /** Adds `delta` (may be negative); the total never goes below zero. */
  adjust(uid: string, delta: number): Promise<void>;
}

export class D1StorageStore implements StorageStore {
  constructor(private readonly db: D1Database) {}

  private async ensureRow(uid: string): Promise<void> {
    await this.db
      .prepare("INSERT OR IGNORE INTO storage_usage (uid, used_bytes, updated_at) VALUES (?1, 0, ?2)")
      .bind(uid, new Date().toISOString())
      .run();
  }

  async getUsed(uid: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT used_bytes FROM storage_usage WHERE uid = ?1")
      .bind(uid)
      .first<{ used_bytes: number }>();
    return row?.used_bytes ?? 0;
  }

  async reserve(uid: string, bytes: number, limit: number): Promise<ReserveBytesResult> {
    await this.ensureRow(uid);
    // Single guarded UPDATE: no row comes back (and nothing changes) when over the limit.
    const row = await this.db
      .prepare(
        `UPDATE storage_usage SET used_bytes = used_bytes + ?2, updated_at = ?3
         WHERE uid = ?1 AND used_bytes + ?2 <= ?4
         RETURNING used_bytes`,
      )
      .bind(uid, bytes, new Date().toISOString(), limit)
      .first<{ used_bytes: number }>();
    if (row) return { ok: true, usedBytes: row.used_bytes };
    return { ok: false, usedBytes: await this.getUsed(uid) };
  }

  async adjust(uid: string, delta: number): Promise<void> {
    if (delta === 0) return;
    await this.ensureRow(uid);
    await this.db
      .prepare("UPDATE storage_usage SET used_bytes = MAX(used_bytes + ?2, 0), updated_at = ?3 WHERE uid = ?1")
      .bind(uid, delta, new Date().toISOString())
      .run();
  }
}
