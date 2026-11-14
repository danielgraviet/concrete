import { describe, expect, it } from "vitest";
import { BurstLimiter } from "../src/burst";
import { D1QuotaStore, periodFor, resetsAtFor } from "../src/quota";
import { makeD1 } from "./helpers";

describe("period math", () => {
  it("uses the UTC month", () => {
    expect(periodFor(new Date("2026-11-14T12:00:00Z"))).toBe("2026-11");
    expect(periodFor(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
    // 23:30 on Dec 31 in UTC-5 is already January in UTC.
    expect(periodFor(new Date("2026-12-31T23:30:00-05:00"))).toBe("2027-01");
  });

  it("resets at the first instant of the next UTC month", () => {
    expect(resetsAtFor(new Date("2026-11-14T12:00:00Z"))).toBe("2026-12-01T00:00:00.000Z");
    expect(resetsAtFor(new Date("2026-12-31T23:59:59Z"))).toBe("2027-01-01T00:00:00.000Z");
    expect(resetsAtFor(new Date("2028-02-29T10:00:00Z"))).toBe("2028-03-01T00:00:00.000Z");
  });
});

describe("D1QuotaStore", () => {
  it("increments atomically up to the limit, then refuses without changing", async () => {
    const { d1 } = makeD1();
    const q = new D1QuotaStore(d1);
    expect(await q.reserve("u", "2026-11", 2)).toEqual({ ok: true, used: 1 });
    expect(await q.reserve("u", "2026-11", 2)).toEqual({ ok: true, used: 2 });
    expect(await q.reserve("u", "2026-11", 2)).toEqual({ ok: false, used: 2 });
    expect(await q.getUsed("u", "2026-11")).toBe(2);
  });

  it("keeps periods and users separate", async () => {
    const { d1 } = makeD1();
    const q = new D1QuotaStore(d1);
    await q.reserve("u", "2026-11", 1);
    expect((await q.reserve("u", "2026-12", 1)).ok).toBe(true);
    expect((await q.reserve("v", "2026-11", 1)).ok).toBe(true);
    expect(await q.getUsed("w", "2026-11")).toBe(0);
  });

  it("treats a null limit as unlimited", async () => {
    const { d1 } = makeD1();
    const q = new D1QuotaStore(d1);
    for (let i = 0; i < 5; i++) await q.reserve("owner", "2026-11", null);
    expect(await q.getUsed("owner", "2026-11")).toBe(5);
  });

  it("denies everything when the limit is 0", async () => {
    const { d1 } = makeD1();
    expect(await new D1QuotaStore(d1).reserve("u", "2026-11", 0)).toEqual({ ok: false, used: 0 });
  });

  it("refunds without going below zero", async () => {
    const { d1 } = makeD1();
    const q = new D1QuotaStore(d1);
    await q.reserve("u", "2026-11", 5);
    await q.refund("u", "2026-11");
    await q.refund("u", "2026-11");
    await q.refund("nobody", "2026-11");
    expect(await q.getUsed("u", "2026-11")).toBe(0);
  });
});

describe("BurstLimiter", () => {
  it("caps concurrency and releases", () => {
    const b = new BurstLimiter(2, 100, 60_000);
    const r1 = b.acquire("u");
    const r2 = b.acquire("u");
    expect(r1 && r2).toBeTruthy();
    expect(b.acquire("u")).toBeNull();
    expect(b.acquire("other")).not.toBeNull();
    r1!();
    r1!(); // idempotent
    expect(b.acquire("u")).not.toBeNull();
  });

  it("caps requests per window", () => {
    let t = 0;
    const b = new BurstLimiter(100, 3, 1000, () => t);
    for (let i = 0; i < 3; i++) b.acquire("u")!();
    expect(b.acquire("u")).toBeNull();
    t = 1001;
    expect(b.acquire("u")).not.toBeNull();
  });
});
