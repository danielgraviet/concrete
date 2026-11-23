/** Streak flame stages and quiz-count ranks shown on the vault home screen. */

export type FlameStageKey = 'ember' | 'spark' | 'campfire' | 'bonfire' | 'bluecore' | 'inferno' | 'eternal';

export type FlameStage = {
  key: FlameStageKey;
  name: string;
  /** Minimum streak (in days) for this stage. */
  min: number;
  /** Overall flame size, 0–1. */
  scale: number;
  /** Flicker speed multiplier; lower is faster. */
  speed: number;
  embers: number;
  sparks?: boolean;
  halo?: boolean;
  /** Gradient stops, tip → base. */
  outer: [string, string];
  mid: [string, string];
  core: [string, string];
  glow: string;
  chip: string;
};

export const FLAME_STAGES: readonly FlameStage[] = [
  { key: 'ember', name: 'Cold ember', min: 0, scale: 0, speed: 1, embers: 0,
    outer: ['#555', '#555'], mid: ['#555', '#555'], core: ['#555', '#555'], glow: 'rgba(120, 120, 120, 0)', chip: '#9a9a9a' },
  { key: 'spark', name: 'Spark', min: 1, scale: 0.55, speed: 1.1, embers: 0,
    outer: ['#ff5a1f', '#ffb000'], mid: ['#ff9d2e', '#ffd166'], core: ['#fff1c1', '#fffbe8'], glow: 'rgba(255, 140, 0, 0.35)', chip: '#ff9d2e' },
  { key: 'campfire', name: 'Campfire', min: 3, scale: 0.7, speed: 1, embers: 2,
    outer: ['#ff4d1a', '#ffa600'], mid: ['#ff8a1f', '#ffd04d'], core: ['#fff1c1', '#ffffff'], glow: 'rgba(255, 120, 0, 0.45)', chip: '#ff8a1f' },
  { key: 'bonfire', name: 'Bonfire', min: 7, scale: 0.84, speed: 0.9, embers: 6,
    outer: ['#f0361d', '#ff9500'], mid: ['#ff7a1a', '#ffc93c'], core: ['#fff0b8', '#ffffff'], glow: 'rgba(255, 90, 0, 0.5)', chip: '#ff6a1a' },
  { key: 'bluecore', name: 'Blue core', min: 14, scale: 0.93, speed: 0.82, embers: 8,
    outer: ['#ff3d1f', '#ff8c00'], mid: ['#ffb020', '#ffe066'], core: ['#7cc4ff', '#e8f6ff'], glow: 'rgba(255, 110, 40, 0.55)', chip: '#5fb4ff' },
  { key: 'inferno', name: 'Inferno', min: 30, scale: 1, speed: 0.68, embers: 14, sparks: true,
    outer: ['#c3125b', '#ff4d1a'], mid: ['#ff5e1a', '#ffb020'], core: ['#a8d8ff', '#ffffff'], glow: 'rgba(240, 40, 80, 0.55)', chip: '#ff3d6e' },
  { key: 'eternal', name: 'Eternal flame', min: 100, scale: 1, speed: 0.85, embers: 12, halo: true,
    outer: ['#f59e00', '#ffd84d'], mid: ['#ffe27a', '#fff6c8'], core: ['#ffffff', '#ffffff'], glow: 'rgba(255, 200, 40, 0.65)', chip: '#f5b800' },
];

export type RankKey = 'sand' | 'pebble' | 'brick' | 'concrete' | 'granite' | 'marble' | 'obsidian' | 'gold' | 'diamond';

export type QuizRank = { key: RankKey; name: string; min: number; label: string; color: string };

export const QUIZ_RANKS: readonly QuizRank[] = [
  { key: 'sand', name: 'Sand', min: 0, label: '0', color: '#b8ad94' },
  { key: 'pebble', name: 'Pebble', min: 1, label: '1', color: '#8f8f8c' },
  { key: 'brick', name: 'Brick', min: 10, label: '10', color: '#c4603f' },
  { key: 'concrete', name: 'Concrete', min: 20, label: '20', color: '#9a9893' },
  { key: 'granite', name: 'Granite', min: 50, label: '50', color: '#c98a82' },
  { key: 'marble', name: 'Marble', min: 100, label: '100', color: '#c9b48c' },
  { key: 'obsidian', name: 'Obsidian', min: 200, label: '200', color: '#8a5cff' },
  { key: 'gold', name: 'Gold', min: 500, label: '500', color: '#e3b13a' },
  { key: 'diamond', name: 'Diamond', min: 1000, label: '1K', color: '#6cc6ff' },
];

function lastAtOrBelow<T extends { min: number }>(tiers: readonly T[], value: number): number {
  let index = 0;
  tiers.forEach((tier, i) => {
    if (value >= tier.min) index = i;
  });
  return index;
}

export type Progression<T> = {
  current: T;
  index: number;
  next: T | null;
  /** How many more are needed to reach `next`; 0 at the top tier. */
  remaining: number;
  /** 0–1 progress from `current` toward `next`; 1 at the top tier. */
  progress: number;
};

function progression<T extends { min: number }>(tiers: readonly T[], value: number): Progression<T> {
  const safe = Math.max(0, Math.floor(value));
  const index = lastAtOrBelow(tiers, safe);
  const current = tiers[index];
  const next = tiers[index + 1] ?? null;
  return {
    current,
    index,
    next,
    remaining: next ? next.min - safe : 0,
    progress: next ? (safe - current.min) / (next.min - current.min) : 1,
  };
}

export function flameProgress(streak: number): Progression<FlameStage> {
  return progression(FLAME_STAGES, streak);
}

export function rankProgress(quizCount: number): Progression<QuizRank> {
  return progression(QUIZ_RANKS, quizCount);
}

/**
 * Remembers the highest quiz rank the home screen has shown, so the rank-up
 * animation plays once per new rank. The first visit records silently.
 */
export class SeenRankStore {
  private readonly key: string;

  constructor(vaultRoot = '') {
    this.key = `mv:home-rank-seen:${vaultRoot || '__default__'}`;
  }

  get(): number | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw === null) return null;
      const value = Number(raw);
      return Number.isInteger(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  }

  set(index: number): void {
    try { localStorage.setItem(this.key, String(index)); } catch { /* Rank-up animation is optional if storage is unavailable. */ }
  }

  /** Records `current` and returns the previous rank index when this is a rank-up. */
  observe(current: number): number | null {
    const seen = this.get();
    if (seen !== current) this.set(current);
    return seen !== null && current > seen ? seen : null;
  }
}
