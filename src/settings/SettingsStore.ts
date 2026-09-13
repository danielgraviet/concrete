import { applyTheme } from './applyTheme';
import type { AppSettings, ThemePackId } from './types';
import { DEFAULT_SETTINGS, DEFAULT_THEME_PACK, isThemePackId } from './types';
import { resolveOpenRouterModelId } from '../ai/openRouterModels';

const STORAGE_KEY = 'mv:settings';

function normalizeTheme(raw: unknown): ThemePackId {
  if (isThemePackId(raw)) return raw;
  // Legacy per-color object → default pack
  return DEFAULT_THEME_PACK;
}

function readStorage(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<AppSettings> & { theme?: unknown };
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      theme: normalizeTheme(parsed.theme),
      autosaveMs:
        typeof parsed.autosaveMs === 'number' ? parsed.autosaveMs : DEFAULT_SETTINGS.autosaveMs,
      providerId:
        typeof parsed.providerId === 'string' ? parsed.providerId : DEFAULT_SETTINGS.providerId,
      openRouterModelId: resolveOpenRouterModelId(parsed.openRouterModelId),
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

/**
 * SettingsStore — localStorage-backed app preferences.
 */
export class SettingsStore {
  private settings: AppSettings;
  private listeners = new Set<(s: AppSettings) => void>();

  constructor() {
    this.settings = readStorage();
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  subscribe(listener: (s: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    for (const listener of this.listeners) listener(this.get());
  }

  setThemePack(packId: ThemePackId): AppSettings {
    const theme = isThemePackId(packId) ? packId : DEFAULT_THEME_PACK;
    this.settings = { ...this.settings, theme };
    applyTheme(this.settings.theme);
    this.persist();
    return this.get();
  }

  setAutosaveMs(ms: number): AppSettings {
    this.settings = { ...this.settings, autosaveMs: Math.max(0, ms) };
    this.persist();
    return this.get();
  }

  setProviderId(providerId: string): AppSettings {
    this.settings = { ...this.settings, providerId };
    this.persist();
    return this.get();
  }

  setOpenRouterModelId(modelId: string): AppSettings {
    this.settings = {
      ...this.settings,
      openRouterModelId: resolveOpenRouterModelId(modelId),
    };
    this.persist();
    return this.get();
  }

  /** Load from storage and apply theme to the document. */
  hydrate(): AppSettings {
    this.settings = readStorage();
    applyTheme(this.settings.theme);
    return this.get();
  }

  reset(): AppSettings {
    this.settings = structuredClone(DEFAULT_SETTINGS);
    applyTheme(this.settings.theme);
    this.persist();
    return this.get();
  }
}

export const settingsStore = new SettingsStore();
