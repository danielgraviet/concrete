/**
 * Best-effort per-uid burst limiter. State lives in isolate memory, so it is not global
 * across Cloudflare's edge -- it only blunts runaway loops from a single client. The D1
 * monthly quota is the real limit.
 */
export class BurstLimiter {
  private readonly inFlight = new Map<string, number>();
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly maxConcurrent = 5,
    private readonly maxPerWindow = 10,
    private readonly windowMs = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Returns a release function, or null if the caller is over the burst limit. */
  acquire(uid: string): (() => void) | null {
    const t = this.now();
    const times = (this.recent.get(uid) ?? []).filter((x) => t - x < this.windowMs);
    const active = this.inFlight.get(uid) ?? 0;
    if (active >= this.maxConcurrent || times.length >= this.maxPerWindow) {
      this.recent.set(uid, times);
      return null;
    }
    times.push(t);
    this.recent.set(uid, times);
    this.inFlight.set(uid, active + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.inFlight.get(uid) ?? 1) - 1;
      if (n <= 0) this.inFlight.delete(uid);
      else this.inFlight.set(uid, n);
    };
  }
}
