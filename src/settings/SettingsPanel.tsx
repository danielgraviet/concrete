import { useEffect, useState } from 'react';
import { Button, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes';
import type { SettingsStore } from './SettingsStore';
import type { AgentProviderId, AppSettings, ThemePackId } from './types';
import { THEME_PACKS } from './themePacks';
import { OPENROUTER_MODEL_OPTIONS } from '../ai/openRouterModels';

type Props = {
  store: SettingsStore;
  providerOptions?: { id: string; label: string }[];
  onClose?: () => void;
};

/**
 * Settings panel — theme packs + AI controls.
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
  const [agentStatus, setAgentStatus] = useState<string | null>(null);

  useEffect(() => store.subscribe(setSettings), [store]);

  useEffect(() => {
    if (settings.agentProviderId !== 'codex') {
      setAgentStatus(null);
      return;
    }
    let cancelled = false;
    void window.ai?.agentStatus?.()
      .then((status) => {
        if (!cancelled) setAgentStatus(status.message);
      })
      .catch((error) => {
        if (!cancelled) {
          setAgentStatus(error instanceof Error ? error.message : 'Codex status failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settings.agentProviderId]);

  return (
    <Flex direction="column" gap="4" className="mv-settings-panel">
      <Flex align="center" justify="between">
        <Heading size="3">Settings</Heading>
        {onClose ? (
          <Button
            type="button"
            variant="soft"
            color="gray"
            highContrast
            onClick={() => onClose()}
          >
            Close
          </Button>
        ) : null}
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Theme
        </Text>
        <Text size="1" color="gray">
          Visual packs for chrome, accents, and type
        </Text>
        <div className="mv-theme-packs">
          {THEME_PACKS.map((pack) => {
            const selected = settings.themePack === pack.id;
            return (
              <button
                key={pack.id}
                type="button"
                className={`mv-theme-pack${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                onClick={() => store.setThemePack(pack.id as ThemePackId)}
              >
                <span className="mv-theme-swatch" aria-hidden>
                  {pack.swatches.map((color) => (
                    <span key={color} style={{ background: color }} />
                  ))}
                </span>
                <span className="mv-theme-pack-meta">
                  <strong>{pack.label}</strong>
                  <small>{pack.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Editor
        </Text>
        <TextField.Root
          type="number"
          min={0}
          step={100}
          value={String(settings.autosaveMs)}
          onChange={(e) => store.setAutosaveMs(Number(e.target.value) || 0)}
        >
          <TextField.Slot side="right">
            <Text size="1" color="gray">
              ms
            </Text>
          </TextField.Slot>
        </TextField.Root>
        <Text size="1" color="gray">
          Autosave delay
        </Text>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Tutor AI
        </Text>
        <Select.Root
          value={settings.providerId}
          onValueChange={(value) => store.setProviderId(value)}
        >
          <Select.Trigger placeholder="Provider" />
          <Select.Content>
            {providerOptions.map((p) => (
              <Select.Item key={p.id} value={p.id}>
                {p.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        {settings.providerId === 'openrouter' ? (
          <Select.Root
            value={settings.openRouterModelId}
            onValueChange={(value) => store.setOpenRouterModelId(value)}
          >
            <Select.Trigger placeholder="Model" />
            <Select.Content>
              {OPENROUTER_MODEL_OPTIONS.map((model) => (
                <Select.Item key={model.id} value={model.id}>
                  {model.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        ) : null}
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Agent
        </Text>
        <Text size="1" color="gray">
          Bring-your-own Codex edits notes on disk
        </Text>
        <Select.Root
          value={settings.agentProviderId}
          onValueChange={(value) =>
            store.setAgentProviderId(value as AgentProviderId)
          }
        >
          <Select.Trigger placeholder="Agent" />
          <Select.Content>
            <Select.Item value="off">Off</Select.Item>
            <Select.Item value="codex">Codex (BYO)</Select.Item>
          </Select.Content>
        </Select.Root>
        {agentStatus ? (
          <Text size="1" color="gray">
            {agentStatus}
          </Text>
        ) : null}
      </Flex>

      <Button variant="soft" color="gray" onClick={() => store.reset()}>
        Reset all settings
      </Button>
    </Flex>
  );
}
