import type { AgentProviderId, AppSettings, ThemePackId } from './types';
import {
  DEFAULT_SETTINGS,
  resolveAgentProviderId,
  resolveThemePack,
} from './types';
import { isThemePackId } from './themePacks';
import { resolveOpenRouterModelId } from '../ai/openRouterModels';

const STORAGE_KEY = 'mv:settings';

function readStorage(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<AppSettings> & {
      /** Legacy theme pack id from older builds. */
      theme?: unknown;
      /** Legacy dark/light toggle from Radix-only builds. */
      appearance?: unknown;
    };
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      themePack: resolveThemePack(parsed),
      autosaveMs:
        typeof parsed.autosaveMs === 'number' ? parsed.autosaveMs : DEFAULT_SETTINGS.autosaveMs,
      providerId:
        typeof parsed.providerId === 'string' ? parsed.providerId : DEFAULT_SETTINGS.providerId,
      openRouterModelId: resolveOpenRouterModelId(parsed.openRouterModelId),
      agentProviderId: resolveAgentProviderId(parsed.agentProviderId),
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

  setThemePack(themePack: ThemePackId): AppSettings {
    this.settings = {
      ...this.settings,
      themePack: isThemePackId(themePack) ? themePack : DEFAULT_SETTINGS.themePack,
    };
    this.persist();
    return this.get();
  }

  /** @deprecated Use setThemePack */
  setAppearance(appearance: 'dark' | 'light'): AppSettings {
    return this.setThemePack(appearance === 'light' ? 'martian' : 'concrete');
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

  setAgentProviderId(agentProviderId: AgentProviderId): AppSettings {
    this.settings = {
      ...this.settings,
      agentProviderId: resolveAgentProviderId(agentProviderId),
    };
    this.persist();
    return this.get();
  }

  hydrate(): AppSettings {
    this.settings = readStorage();
    return this.get();
  }

  reset(): AppSettings {
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.persist();
    return this.get();
  }
}

export const settingsStore = new SettingsStore();
