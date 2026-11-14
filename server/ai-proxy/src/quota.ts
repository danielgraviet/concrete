/** Monthly per-user quota, stored in D1 keyed by (uid, period 'YYYY-MM' in UTC). */

export interface QuotaInfo {
  used: number;
  limit: number;
  resetsAt: string;
}

export interface ReserveResult {
  ok: boolean;
  used: number;
}

export interface QuotaStore {
  getUsed(uid: string, period: string): Promise<number>;
  /** Atomically adds one unit if used < limit (limit === null means unlimited). */
  reserve(uid: string, period: string, limit: number | null): Promise<ReserveResult>;
  /** Gives back one unit (never below zero). */
  refund(uid: string, period: string): Promise<void>;
}

/** Sentinel `limit` reported for allowlisted (unlimited) users. */
export const UNLIMITED = -1;

export function periodFor(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** First instant of the next UTC month, as ISO-8601. */
export function resetsAtFor(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
}

export class D1QuotaStore implements QuotaStore {
  constructor(private readonly db: D1Database) {}

  async getUsed(uid: string, period: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT used FROM usage WHERE uid = ?1 AND period = ?2")
      .bind(uid, period)
      .first<{ used: number }>();
    return row?.used ?? 0;
  }

  async reserve(uid: string, period: string, limit: number | null): Promise<ReserveResult> {
    if (limit !== null && limit <= 0) {
      return { ok: false, used: await this.getUsed(uid, period) };
    }
    const now = new Date().toISOString();
    // Single statement: insert the first unit, or increment only while under the limit.
    // When the WHERE guard fails, no row is returned and nothing changes.
    const row = await this.db
      .prepare(
        `INSERT INTO usage (uid, period, used, updated_at) VALUES (?1, ?2, 1, ?3)
         ON CONFLICT (uid, period) DO UPDATE
           SET used = used + 1, updated_at = excluded.updated_at
           WHERE ?4 IS NULL OR used < ?4
         RETURNING used`,
      )
      .bind(uid, period, now, limit)
      .first<{ used: number }>();
    if (row) return { ok: true, used: row.used };
    return { ok: false, used: await this.getUsed(uid, period) };
  }

  async refund(uid: string, period: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE usage SET used = MAX(used - 1, 0), updated_at = ?3 WHERE uid = ?1 AND period = ?2",
      )
      .bind(uid, period, new Date().toISOString())
      .run();
  }
}
