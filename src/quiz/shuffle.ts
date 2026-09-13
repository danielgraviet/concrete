/** Seeded RNG + Fisher–Yates for stable MCA presentation within a take session. */

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 — deterministic [0, 1) from a 32-bit seed. */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

export function shuffledCopy<T>(items: readonly T[], rng: () => number): T[] {
  return shuffleInPlace([...items], rng);
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function optionLetter(index: number): string {
  if (index < 0) return '?';
  if (index < LETTERS.length) return LETTERS[index];
  return `${LETTERS[index % LETTERS.length]}${Math.floor(index / LETTERS.length)}`;
}
