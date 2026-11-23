/** Small helpers for the home screen's generated SVG art. */

/** React ids contain characters that break `url(#…)` references; keep only safe ones. */
export function svgId(reactId: string): string {
  return `mv${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** Deterministic PRNG (mulberry32) so textures render identically on every render. */
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Point = [number, number];

/** Pointy-top hexagon corners, clockwise from the top. */
export function hexPoints(cx: number, cy: number, r: number): Point[] {
  return [-90, -30, 30, 90, 150, 210].map((deg) => {
    const t = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  });
}

export function pointList(points: Point[]): string {
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}
