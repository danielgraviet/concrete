import { describe, expect, it } from 'vitest';
import { flameProgress, rankProgress } from './homeMilestones';

describe('flameProgress', () => {
  it.each([
    [0, 'ember', 'spark', 1],
    [1, 'spark', 'campfire', 2],
    [6, 'campfire', 'bonfire', 1],
    [7, 'bonfire', 'bluecore', 7],
    [29, 'bluecore', 'inferno', 1],
    [30, 'inferno', 'eternal', 70],
  ])('streak %i is %s, next %s in %i', (streak, key, next, remaining) => {
    const result = flameProgress(streak);
    expect(result.current.key).toBe(key);
    expect(result.next?.key).toBe(next);
    expect(result.remaining).toBe(remaining);
  });

  it('tops out at the eternal flame', () => {
    const result = flameProgress(365);
    expect(result.current.key).toBe('eternal');
    expect(result.next).toBeNull();
    expect(result.remaining).toBe(0);
    expect(result.progress).toBe(1);
  });
});

describe('rankProgress', () => {
  it.each([
    [0, 'sand'],
    [1, 'pebble'],
    [9, 'pebble'],
    [10, 'brick'],
    [20, 'concrete'],
    [50, 'granite'],
    [100, 'marble'],
    [200, 'obsidian'],
    [500, 'gold'],
    [999, 'gold'],
    [1000, 'diamond'],
  ])('%i quizzes is %s', (count, key) => {
    expect(rankProgress(count).current.key).toBe(key);
  });

  it('reports progress toward the next rank', () => {
    const result = rankProgress(35);
    expect(result.current.key).toBe('concrete');
    expect(result.next?.key).toBe('granite');
    expect(result.progress).toBeCloseTo(0.5);
  });

  it('treats negative and fractional counts safely', () => {
    expect(rankProgress(-4).current.key).toBe('sand');
    expect(rankProgress(9.9).current.key).toBe('pebble');
  });
});

