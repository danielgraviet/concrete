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
import { CLAUDE_MODEL_OPTIONS } from '../ai/claudeModels';
import { isChatBackendId, type ChatBackendId } from '../ai/ChatModelProvider';
import { getSandboxStatus, onSandboxProgress, prepareSandboxImage, type SandboxStatus } from '../sandbox';

type Props = {
  store: SettingsStore;
  vaultRoot?: string | null;
  onOpenVault?: () => void;
  onImportObsidian?: () => void;
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
  | 'vault'
  | 'activity';

/**
 * Settings panel — theme packs + AI controls.
 */
export function SettingsPanel({
  store,
  vaultRoot,
  onOpenVault,
  onImportObsidian,
  onReplayOnboarding,
  providerOptions = [
    { id: 'openrouter', label: 'OpenRouter' },
    { id: 'claude', label: 'Claude Code' },
    { id: 'codex', label: 'Codex' },
    { id: 'mock', label: 'Mock AI' },
    { id: 'local-echo', label: 'Local Echo' },
  ],
  onClose,
}: Props) {
  const [settings, setSettings] = useState<AppSettings>(() => store.get());
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [sandboxProviders, setSandboxProviders] = useState<Array<{ id: string; label: string }>>([]);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null);
  const [settingUp, setSettingUp] = useState<string | null>(null);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [section, setSection] = useState<SettingsSection>('appearance');
  const [activity, setActivity] = useState<Array<Record<string, unknown>>>([]);
  const [trajectories, setTrajectories] = useState<Array<{ file: string; records: Array<Record<string, unknown>>; location: string }>>([]);
  const [trajectoryScanStatus, setTrajectoryScanStatus] = useState<string | null>(null);

  const scanTrajectories = async () => {
    console.log('[trajectory] scan button clicked');
    const scan = window.ai?.trajectories;
    if (typeof scan !== 'function') {
      console.error('[trajectory] preload bridge is unavailable');
      setTrajectoryScanStatus('Trajectory scanner unavailable — restart npm run dev');
      return;
    }
    setTrajectoryScanStatus('Scanning…');
    try {
      const items = await scan();
      console.log('[trajectory] renderer received', items.length, 'file(s)');
      setTrajectories(items);
      setTrajectoryScanStatus(`${items.length} trajectory file${items.length === 1 ? '' : 's'} found`);
    } catch (error) {
      console.error('[trajectory] renderer scan failed', error);
      setTrajectoryScanStatus(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  useEffect(() => store.subscribe(setSettings), [store]);

  const backend: ChatBackendId | null = isChatBackendId(settings.providerId) ? settings.providerId : null;

  useEffect(() => {
    setAiStatus(null);
    setKeyStatus(null);
    if (!backend || !window.ai?.status) return;
    let cancelled = false;
    void window.ai.status(backend).then((status) => {
      if (!cancelled) setAiStatus(status);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [backend]);

  useEffect(() => {
    void window.sandbox?.providers().then(setSandboxProviders).catch(() => setSandboxProviders([]));
  }, []);

  useEffect(() => {
    if (section !== 'quiz') return;
    let cancelled = false;
    setSandboxStatus(null);
    void getSandboxStatus(settings.sandboxProviderId).then((status) => {
      if (!cancelled) setSandboxStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [section, settings.sandboxProviderId]);

  useEffect(() => {
    if (section !== 'activity' || !window.ai?.activity) return;
    void window.ai.activity().then(setActivity).catch(() => setActivity([]));
    void scanTrajectories();
  }, [section]);

  useEffect(() => {
    if (settings.agentProviderId === 'off') {
      setAgentStatus(null);
      return;
    }
    let cancelled = false;
    void window.ai?.agentStatus?.({ agentProviderId: settings.agentProviderId })
      .then((status) => {
        if (!cancelled) setAgentStatus(status.message);
      })
      .catch((error) => {
        if (!cancelled) {
          setAgentStatus(error instanceof Error ? error.message : 'Agent status failed');
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
          ['activity', 'AI Activity'],
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
          <label className="mv-quiz-count-field">
            <Text size="1" color="gray">
              Code
            </Text>
            <TextField.Root
              type="number"
              min={0}
              max={20}
              value={String(settings.quiz.codeCount)}
              onChange={(e) =>
                store.setQuizSettings({ codeCount: Number(e.target.value) || 0 })
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
          Open-answer grading rubric
        </Text>
        <TextField.Root
          value={settings.quiz.customRubric}
          placeholder="e.g. Prefer precise definitions; deduct for vague answers"
          onChange={(e) => store.setQuizSettings({ customRubric: e.target.value })}
        />
        <Text size="1" color="gray">
          Written into quiz frontmatter when set. Leave blank for a generated rubric.
        </Text>

        <Text size="2" weight="medium">
          Code execution
        </Text>
        <Select.Root
          value={settings.sandboxProviderId}
          onValueChange={(value) => store.setSandboxProviderId(value)}
          disabled={sandboxProviders.length === 0}
        >
          <Select.Trigger placeholder="Code runner" />
          <Select.Content>
            {sandboxProviders.map((provider) => (
              <Select.Item key={provider.id} value={provider.id}>
                {provider.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <Text size="1" color="gray">
          {sandboxStatus
            ? `${sandboxStatus.available ? 'Ready' : 'Unavailable'} — ${sandboxStatus.detail ?? ''}`
            : 'Checking…'}{' '}
          Code questions run here to verify their answers; without a runner they are marked unverified.
        </Text>
        {sandboxStatus?.available
          ? sandboxStatus.images
              ?.filter((image) => image.buildable)
              .map((image) => (
                <Flex key={image.id} align="center" justify="between" gap="3">
                  <Text size="1" color="gray">
                    {image.label}: {image.ready ? 'ready' : `not set up (${image.sizeHint ?? 'one-time build'})`}
                  </Text>
                  {image.ready ? null : (
                    <Button
                      size="1"
                      variant="soft"
                      disabled={settingUp !== null}
                      onClick={() => {
                        setSettingUp(image.id);
                        setSetupMessage(null);
                        const stop = onSandboxProgress(setSetupMessage);
                        void prepareSandboxImage(image.id, settings.sandboxProviderId)
                          .then((result) => {
                            setSetupMessage(result.ok ? null : result.error ?? 'Setup failed.');
                            return getSandboxStatus(settings.sandboxProviderId).then(setSandboxStatus);
                          })
                          .finally(() => {
                            stop();
                            setSettingUp(null);
                          });
                      }}
                    >
                      {settingUp === image.id ? 'Setting up…' : 'Set up now'}
                    </Button>
                  )}
                </Flex>
              ))
          : null}
        {setupMessage ? (
          <Text size="1" color="gray">
            {setupMessage}
          </Text>
        ) : null}
        <Text size="1" color="gray">
          Python code that imports numpy, pandas, scipy, scikit-learn or sympy runs in the data-science image
          automatically; everything else uses the small default image. Code still has no network access.
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
        {backend ? (
          <>
            {backend === 'openrouter' ? (
              aiStatus?.configured ? (
                <Text size="1" color="green">
                  ✓ API key already set{aiStatus.keySuffix ? ` (ending …${aiStatus.keySuffix})` : ''} — ready to go.
                  {' '}Enter a new key below only if you want to replace it.
                </Text>
              ) : (
                <Text size="1" color="gray">
                  No API key configured yet. Add one below, or set OPENROUTER_API_KEY in the project .env.
                </Text>
              )
            ) : aiStatus?.message ? (
              <Text size="1" color={aiStatus.configured ? 'green' : 'gray'}>
                {aiStatus.configured ? '✓ ' : ''}{aiStatus.message}
              </Text>
            ) : null}
            {backend !== 'openrouter' ? (
              <Text size="1" color="gray">
                {backend === 'claude'
                  ? 'Uses your Claude Code login (Pro/Max subscription). An Anthropic API key, if set, is used instead.'
                  : 'Uses your Codex login (ChatGPT subscription) and the model from your Codex config. An OpenAI API key, if set, is used instead.'}
              </Text>
            ) : null}
            <TextField.Root
              type="password"
              placeholder={
                aiStatus?.keySuffix
                  ? 'Replace saved key (optional)'
                  : backend === 'openrouter'
                    ? 'OpenRouter API key'
                    : backend === 'claude'
                      ? 'Anthropic API key (optional)'
                      : 'OpenAI API key (optional)'
              }
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
            />
            <Flex align="center" gap="2">
              <Button
                type="button"
                variant="soft"
                disabled={!apiKeyInput.trim() || !window.ai?.setApiKey}
                onClick={() => {
                  void window.ai?.setApiKey(apiKeyInput.trim(), backend).then((status) => {
                    setApiKeyInput('');
                    setAiStatus(status);
                    setKeyStatus('Key saved.');
                  }).catch((error) => setKeyStatus(error instanceof Error ? error.message : 'Could not save key.'));
                }}
              >
                Save key
              </Button>
              {backend !== 'openrouter' && aiStatus?.keySuffix ? (
                <Button
                  type="button"
                  variant="soft"
                  color="gray"
                  onClick={() => {
                    void window.ai?.setApiKey('', backend).then((status) => {
                      setAiStatus(status);
                      setKeyStatus('Key removed. Using your CLI login.');
                    }).catch((error) => setKeyStatus(error instanceof Error ? error.message : 'Could not remove key.'));
                  }}
                >
                  Use login instead
                </Button>
              ) : null}
              {keyStatus ? <Text size="1" color="gray">{keyStatus}</Text> : null}
            </Flex>
            <Text size="1" color="gray">
              Stored locally on this device and never shown again.
            </Text>
          </>
        ) : null}
        {backend === 'openrouter' || backend === 'claude' ? (
          <Select.Root
            value={backend === 'openrouter' ? settings.openRouterModelId : settings.claudeModelId}
            onValueChange={(value) =>
              backend === 'openrouter' ? store.setOpenRouterModelId(value) : store.setClaudeModelId(value)
            }
          >
            <Select.Trigger placeholder="Model" />
            <Select.Content>
              {(backend === 'openrouter' ? OPENROUTER_MODEL_OPTIONS : CLAUDE_MODEL_OPTIONS).map((model) => (
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
          Bring-your-own agent edits notes on disk, using your own Codex or Claude Code login, or the API key saved under Tutor AI.
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
            <Select.Item value="claude">Claude (BYO)</Select.Item>
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
          onClick={onImportObsidian}
          disabled={!onImportObsidian}
        >
          Import Obsidian Vault
        </Button>
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

      <Flex direction="column" gap="2" className={`mv-settings-group ${section === 'activity' ? 'active' : ''}`}>
        <Text size="2" weight="medium">AI Activity</Text>
        <Text size="1" color="gray">Recent API calls plus agent trajectories stored in Documents/Concrete (outside the Markdown vault).</Text>
        <Flex gap="2">
          <Button type="button" variant="soft" onClick={() => window.ai?.activity?.().then(setActivity)}>
            Refresh
          </Button>
          <Button type="button" variant="soft" onClick={() => void scanTrajectories()}>
            Scan trajectories
          </Button>
          <Button type="button" variant="soft" color="gray" onClick={() => window.ai?.activityClear?.().then(() => setActivity([]))}>
            Clear log
          </Button>
        </Flex>
        {trajectoryScanStatus ? <Text size="1" color="gray">{trajectoryScanStatus}</Text> : null}
        <div className="mv-ai-activity-list">
          {activity.length === 0 ? <Text size="1" color="gray">No API calls recorded yet.</Text> : activity.map((event, index) => (
            <details key={`${String(event.requestId ?? index)}`}>
              <summary>
                {String(event.operation ?? 'request')} · {String(event.status ?? '')} · {event.durationMs ? `${String(event.durationMs)}ms` : '—'}
                {typeof event.error === 'string' ? ` · ${event.error.slice(0, 80)}` : ''}
              </summary>
              {typeof event.responseText === 'string' ? (
                <>
                  <Text size="1" weight="medium">Raw model response</Text>
                  <pre>{event.responseText}</pre>
                </>
              ) : null}
              <pre>{JSON.stringify({ ...event, responseText: undefined, messages: undefined }, null, 2)}</pre>
              {Array.isArray(event.messages) ? (
                <details>
                  <summary>Prompt sent</summary>
                  <pre>
                    {(event.messages as Array<{ role?: string; content?: string }>)
                      .map((m) => `[${m.role}]\n${m.content}`)
                      .join('\n\n')}
                  </pre>
                </details>
              ) : null}
            </details>
          ))}
        </div>
        <Text size="2" weight="medium">Agent trajectories ({trajectories.length})</Text>
        <div className="mv-ai-activity-list">
          {trajectories.length === 0 ? <Text size="1" color="gray">No agent trajectories recorded yet.</Text> : trajectories.map((trajectory) => (
            <details key={trajectory.file}>
              <summary>{trajectory.file} · {trajectory.records.length} events · {trajectory.location}</summary>
              <pre>{JSON.stringify(trajectory.records, null, 2)}</pre>
            </details>
          ))}
        </div>
      </Flex>

      <Button variant="soft" color="gray" onClick={() => store.reset()}>
        Reset all settings
      </Button>
    </Flex>
  );
}
