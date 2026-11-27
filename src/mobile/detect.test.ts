import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPhoneScreen } from './detect';

const stubWindow = (innerWidth: number, matches: Record<string, boolean>) => {
  vi.stubGlobal('window', {
    innerWidth,
    matchMedia: (query: string) => ({ matches: matches[query] ?? false }),
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isPhoneScreen', () => {
  it('is true for a narrow touch screen', () => {
    stubWindow(390, { '(pointer: coarse)': true });
    expect(isPhoneScreen()).toBe(true);
  });

  it('is true for a narrow screen that cannot hover, even with a fine pointer', () => {
    stubWindow(414, { '(hover: none)': true });
    expect(isPhoneScreen()).toBe(true);
  });

  it('is false for a tablet-width device', () => {
    stubWindow(820, { '(pointer: coarse)': true, '(hover: none)': true });
    expect(isPhoneScreen()).toBe(false);
  });

  it('is false for a narrow desktop window (mouse, hover)', () => {
    stubWindow(600, {});
    expect(isPhoneScreen()).toBe(false);
  });

  it('is false without a window', () => {
    vi.stubGlobal('window', undefined);
    expect(isPhoneScreen()).toBe(false);
  });
});
