import { useEffect, useState } from 'react';
import type { SettingsStore } from './SettingsStore';
import type { AppSettings } from './types';
import { THEME_PACK_LIST } from './types';
import { OPENROUTER_MODEL_OPTIONS } from '../ai/openRouterModels';

type Props = {
  store: SettingsStore;
  providerOptions?: { id: string; label: string }[];
  onClose?: () => void;
};

/**
 * Settings panel — theme packs, autosave, AI provider + model.
 */
export function SettingsPanel({
  store,
  providerOptions = [
    { id: 'openrouter', label: 'OpenRouter' },
    { id: 'mock', label: 'Mock AI' },
    { id: 'local-echo', label: 'Local Echo' },
  ],
  onClose,
}: Props) {
  const [settings, setSettings] = useState<AppSettings>(() => store.get());

  useEffect(() => store.subscribe(setSettings), [store]);

  return (
    <div className="mv-settings-panel">
      <div className="mv-panel-header">
        <div className="mv-panel-label">SETTINGS</div>
        {onClose ? (
          <button type="button" className="mv-link" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>

      <section className="mv-settings-section">
        <h4>Theme</h4>
        <p className="mv-settings-hint">Pick a pack. Colors apply together.</p>
        <div className="mv-theme-packs" role="radiogroup" aria-label="Theme pack">
          {THEME_PACK_LIST.map((pack) => {
            const selected = settings.theme === pack.id;
            return (
              <button
                key={pack.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`mv-theme-pack ${selected ? 'selected' : ''}`}
                onClick={() => store.setThemePack(pack.id)}
              >
                <span className="mv-theme-swatch" aria-hidden>
                  <span style={{ background: pack.colors.bg }} />
                  <span style={{ background: pack.colors.surface }} />
                  <span style={{ background: pack.colors.accent }} />
                </span>
                <span className="mv-theme-pack-meta">
                  <strong>{pack.name}</strong>
                  <small>{pack.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mv-settings-section">
        <h4>Editor</h4>
        <label className="mv-field">
          <span>Autosave delay (ms)</span>
          <input
            type="number"
            min={0}
            step={100}
            value={settings.autosaveMs}
            onChange={(e) => store.setAutosaveMs(Number(e.target.value) || 0)}
          />
        </label>
      </section>

      <section className="mv-settings-section">
        <h4>AI</h4>
        <label className="mv-field">
          <span>Default provider</span>
          <select
            value={settings.providerId}
            onChange={(e) => store.setProviderId(e.target.value)}
          >
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {settings.providerId === 'openrouter' ? (
          <label className="mv-field">
            <span>OpenRouter model</span>
            <select
              value={settings.openRouterModelId}
              onChange={(e) => store.setOpenRouterModelId(e.target.value)}
            >
              {OPENROUTER_MODEL_OPTIONS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} — {model.description}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      <button type="button" className="mv-btn mv-btn-ghost" onClick={() => store.reset()}>
        Reset all settings
      </button>
    </div>
  );
}
