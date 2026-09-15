import { useEffect, useState } from 'react';
import { Button, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes';
import type { SettingsStore } from './SettingsStore';
import type {
  AgentProviderId,
  AppSettings,
  QuizDifficulty,
  ThemePackId,
} from './types';
import { THEME_PACKS } from './themePacks';
import { OPENROUTER_MODEL_OPTIONS } from '../ai/openRouterModels';

type Props = {
  store: SettingsStore;
  vaultRoot?: string | null;
  onOpenVault?: () => void;
  onReplayOnboarding?: () => void;
  providerOptions?: { id: string; label: string }[];
  onClose?: () => void;
};

type SettingsSection =
  | 'appearance'
  | 'editor'
  | 'quiz'
  | 'ai'
  | 'agent'
  | 'vault';

/**
 * Settings panel — theme packs + AI controls.
 */
export function SettingsPanel({
  store,
  vaultRoot,
  onOpenVault,
  onReplayOnboarding,
  providerOptions = [
    { id: 'openrouter', label: 'OpenRouter' },
    { id: 'mock', label: 'Mock AI' },
    { id: 'local-echo', label: 'Local Echo' },
  ],
  onClose,
}: Props) {
  const [settings, setSettings] = useState<AppSettings>(() => store.get());
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [section, setSection] = useState<SettingsSection>('appearance');

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

      <div className="mv-settings-nav" role="tablist" aria-label="Settings sections">
        {([
          ['appearance', 'Appearance'],
          ['editor', 'Editor'],
          ['quiz', 'Quiz'],
          ['ai', 'Tutor AI'],
          ['agent', 'Agent'],
          ['vault', 'Vault'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            className={section === id ? 'selected' : ''}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <Flex direction="column" gap="2" className={`mv-settings-group ${section === 'appearance' ? 'active' : ''}`}>
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

      <Flex direction="column" gap="2" className={`mv-settings-group ${section === 'editor' ? 'active' : ''}`}>
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

      <Flex direction="column" gap="3" className={`mv-settings-group ${section === 'quiz' ? 'active' : ''}`}>
        <Text size="2" weight="medium">
          Quiz generation
        </Text>
        <Text size="1" color="gray">
          Defaults used when you generate a quiz from notes
        </Text>

        <Flex gap="3" wrap="wrap">
          <label className="mv-quiz-count-field">
            <Text size="1" color="gray">
              MCQ
            </Text>
            <TextField.Root
              type="number"
              min={0}
              max={20}
              value={String(settings.quiz.mcqCount)}
              onChange={(e) =>
                store.setQuizSettings({ mcqCount: Number(e.target.value) || 0 })
              }
            />
          </label>
          <label className="mv-quiz-count-field">
            <Text size="1" color="gray">
              Cloze
            </Text>
            <TextField.Root
              type="number"
              min={0}
              max={20}
              value={String(settings.quiz.clozeCount)}
              onChange={(e) =>
                store.setQuizSettings({ clozeCount: Number(e.target.value) || 0 })
              }
            />
          </label>
          <label className="mv-quiz-count-field">
            <Text size="1" color="gray">
              Open
            </Text>
            <TextField.Root
              type="number"
              min={0}
              max={20}
              value={String(settings.quiz.openCount)}
              onChange={(e) =>
                store.setQuizSettings({ openCount: Number(e.target.value) || 0 })
              }
            />
          </label>
        </Flex>

        <Text size="2" weight="medium">
          Difficulty
        </Text>
        <Select.Root
          value={settings.quiz.difficulty}
          onValueChange={(value) =>
            store.setQuizSettings({ difficulty: value as QuizDifficulty })
          }
        >
          <Select.Trigger placeholder="Difficulty" />
          <Select.Content>
            <Select.Item value="easy">Easy</Select.Item>
            <Select.Item value="medium">Medium</Select.Item>
            <Select.Item value="hard">Hard</Select.Item>
          </Select.Content>
        </Select.Root>

        <Text size="2" weight="medium">
          Custom rubric
        </Text>
        <TextField.Root
          value={settings.quiz.customRubric}
          placeholder="e.g. Prefer precise definitions; deduct for vague answers"
          onChange={(e) => store.setQuizSettings({ customRubric: e.target.value })}
        />
        <Text size="1" color="gray">
          Written into quiz frontmatter when set. Leave blank for a generated rubric.
        </Text>
      </Flex>

      <Flex direction="column" gap="2" className={`mv-settings-group ${section === 'ai' ? 'active' : ''}`}>
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
          <>
            <TextField.Root
              type="password"
              placeholder="OpenRouter API key"
              value={openRouterKey}
              onChange={(event) => setOpenRouterKey(event.target.value)}
            />
            <Flex align="center" gap="2">
              <Button
                type="button"
                variant="soft"
                disabled={!openRouterKey.trim() || !window.ai?.setApiKey}
                onClick={() => {
                  void window.ai?.setApiKey(openRouterKey.trim()).then((status) => {
                    setOpenRouterKey('');
                    setKeyStatus(status.configured ? 'OpenRouter key saved.' : 'Key cleared.');
                  }).catch((error) => setKeyStatus(error instanceof Error ? error.message : 'Could not save key.'));
                }}
              >
                Save key
              </Button>
              {keyStatus ? <Text size="1" color="gray">{keyStatus}</Text> : null}
            </Flex>
            <Text size="1" color="gray">
              Stored locally on this device and never shown again.
            </Text>
          </>
        ) : null}
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

      <Flex direction="column" gap="2" className={`mv-settings-group ${section === 'agent' ? 'active' : ''}`}>
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

      <Flex direction="column" gap="2" className={`mv-settings-group ${section === 'vault' ? 'active' : ''}`}>
        <Text size="2" weight="medium">Vault</Text>
        <Text size="1" color="gray">Your notes stay in this local folder.</Text>
        <Text size="1" color="gray">{vaultRoot ?? 'No vault selected'}</Text>
        <Button type="button" variant="soft" onClick={onOpenVault} disabled={!onOpenVault}>Choose vault folder</Button>
        <Button
          type="button"
          variant="soft"
          color="gray"
          onClick={onReplayOnboarding}
          disabled={!onReplayOnboarding}
        >
          Replay demo
        </Button>
        <Text size="1" color="gray">
          Walk through how Concrete compares to Notion and Obsidian.
        </Text>
      </Flex>

      <Button variant="soft" color="gray" onClick={() => store.reset()}>
        Reset all settings
      </Button>
    </Flex>
  );
}
