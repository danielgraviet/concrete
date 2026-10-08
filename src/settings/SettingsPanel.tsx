import { lazy, Suspense, useEffect, useState } from 'react';
import { Button, Flex, Heading, Link, Select, Text, TextField } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import type { SettingsStore } from './SettingsStore';
import type {
  AgentProviderId,
  AppSettings,
  QuizDifficulty,
  ThemePackId,
} from './types';
import { THEME_PACKS } from './themePacks';
import { BRAND_LOGOS } from './types';
import { BrandLogo } from '../branding/BrandLogo';
import { OPENROUTER_KEYS_URL, OPENROUTER_MODEL_OPTIONS } from '../ai/openRouterModels';
import { CLAUDE_MODEL_OPTIONS } from '../ai/claudeModels';
import { isChatBackendId, type ChatBackendId } from '../ai/ChatModelProvider';
import { getSandboxStatus, onSandboxProgress, prepareSandboxImage, type SandboxStatus } from '../sandbox';
import { DaytonaKeyField } from './DaytonaKeyField';

// Charts load only when the AI Activity tab is opened.
const TelemetryView = lazy(() =>
  import('../telemetry/TelemetryPage').then((m) => ({ default: m.TelemetryView })),
);

type Props = {
  store: SettingsStore;
  vaultRoot?: string | null;
  onImportObsidian?: () => void;
  onImportNotion?: () => void;
  onReplayOnboarding?: () => void;
  providerOptions?: { id: string; label: string }[];
  onClose?: () => void;
};

type SettingsSection =
  | 'appearance'
  | 'editor'
  | 'quiz'
  | 'review'
  | 'ai'
  | 'agent'
  | 'vault'
  | 'activity';

const SECTIONS: ReadonlyArray<readonly [SettingsSection, string]> = [
  ['appearance', 'Appearance'],
  ['editor', 'Editor'],
  ['quiz', 'Quiz'],
  ['review', 'Review'],
  ['ai', 'Tutor AI'],
  ['agent', 'Agent'],
  ['vault', 'Vault'],
  ['activity', 'AI Activity'],
];

/**
 * Full-window settings: section tabs down the left, the active section on the right.
 */
export function SettingsPanel({
  store,
  vaultRoot,
  onImportObsidian,
  onImportNotion,
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
    <div className="mv-settings-panel mv-settings-page" role="dialog" aria-modal="true" aria-label="Settings">
      <aside className="mv-settings-sidebar">
        <div className="mv-settings-sidebar-head">
          {onClose ? (
            <button type="button" className="mv-settings-close" onClick={onClose} aria-label="Close settings" title="Close settings (Esc)">
              <ArrowLeftIcon />
            </button>
          ) : null}
          <Heading size="3">Settings</Heading>
        </div>
        <nav className="mv-settings-nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
          {SECTIONS.map(([id, label]) => (
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
        </nav>
        <Button variant="soft" color="gray" size="1" className="mv-settings-reset" onClick={() => store.reset()}>
          Reset all settings
        </Button>
      </aside>

      <main className={`mv-settings-content${section === 'activity' ? ' wide' : ''}`}>
      {section === 'activity' ? (
        <Suspense fallback={<Text size="2" color="gray">Loading activity…</Text>}>
          <TelemetryView />
        </Suspense>
      ) : null}

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
        <Text size="2" weight="medium" className="mv-branding-title">
          Logo
        </Text>
        <Text size="1" color="gray">
          Choose a mark to preview in the app’s primary rail. Your selection is saved locally.
        </Text>
        <div className="mv-brand-logo-options">
          {BRAND_LOGOS.map((logo) => {
            const selected = settings.brandLogo === logo.id;
            return (
              <button
                key={logo.id}
                type="button"
                className={`mv-brand-logo-option${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                onClick={() => store.setBrandLogo(logo.id)}
              >
                <span className="mv-brand-logo-sample">
                  <BrandLogo logo={logo.id} />
                </span>
                <span className="mv-brand-logo-meta">
                  <strong>{logo.label}</strong>
                  <small>{logo.description}</small>
                </span>
                <span className="mv-brand-rail-preview" aria-hidden="true">
                  <BrandLogo logo={logo.id} />
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

      <Flex direction="column" gap="3" className={`mv-settings-group ${section === 'review' ? 'active' : ''}`}>
        <Text size="2" weight="medium">
          Spaced repetition
        </Text>
        <Text size="1" color="gray">
          Cards are scheduled with FSRS, the algorithm Anki uses. Higher retention means more
          reviews but fewer forgotten cards.
        </Text>
        <Flex gap="3" wrap="wrap">
          <label className="mv-quiz-count-field">
            <Text size="1" color="gray">
              Target retention %
            </Text>
            <TextField.Root
              type="number"
              min={70}
              max={97}
              value={String(Math.round(settings.review.retention * 100))}
              onChange={(e) => store.setReviewSettings({ retention: (Number(e.target.value) || 90) / 100 })}
            />
          </label>
          <label className="mv-quiz-count-field">
            <Text size="1" color="gray">
              New cards / day
            </Text>
            <TextField.Root
              type="number"
              min={0}
              value={String(settings.review.newPerDay)}
              onChange={(e) => store.setReviewSettings({ newPerDay: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="mv-quiz-count-field">
            <Text size="1" color="gray">
              Max reviews / day
            </Text>
            <TextField.Root
              type="number"
              min={0}
              value={String(settings.review.maxReviewsPerDay)}
              onChange={(e) => store.setReviewSettings({ maxReviewsPerDay: Number(e.target.value) || 0 })}
            />
          </label>
        </Flex>
        <Text size="2" weight="medium">
          Cloze answers
        </Text>
        <Select.Root
          value={settings.review.typeCloze ? 'type' : 'reveal'}
          onValueChange={(value) => store.setReviewSettings({ typeCloze: value === 'type' })}
        >
          <Select.Trigger />
          <Select.Content>
            <Select.Item value="reveal">Reveal the answer</Select.Item>
            <Select.Item value="type">Type the answer</Select.Item>
          </Select.Content>
        </Select.Root>
        <Text size="1" color="gray">
          Write cards in any note: <code>Question :: Answer</code>, <code>Term ::: Definition</code>{' '}
          (both directions), or <code>{'{{cloze}}'}</code> blanks. Review history is saved in{' '}
          <code>.vault/srs.json</code> inside your vault.
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
              max={50}
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
              max={50}
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
              max={50}
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
              max={50}
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
        {settings.sandboxProviderId === 'daytona' ? (
          <DaytonaKeyField
            onChange={() => void getSandboxStatus('daytona').then(setSandboxStatus)}
          />
        ) : null}
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
            <Flex align="center" gap="2" wrap="wrap">
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
              {backend === 'openrouter' ? (
                <Link size="1" href={OPENROUTER_KEYS_URL} target="_blank" rel="noreferrer">
                  Get an OpenRouter API key →
                </Link>
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
          Bring-your-own agent edits notes on disk using your Codex or Claude Code CLI login. Tutor AI API keys are kept separate.
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
        <Text size="1" color="gray">Your Markdown files live in Documents/Concrete.</Text>
        <Text size="1" color="gray">{vaultRoot ?? 'Documents/Concrete'}</Text>
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
          onClick={onImportNotion}
          disabled={!onImportNotion}
        >
          Import Notion Export
        </Button>
        <Button
          type="button"
          variant="soft"
          color="gray"
          onClick={onReplayOnboarding}
          disabled={!onReplayOnboarding}
        >
          Replay walkthrough
        </Button>
        <Text size="1" color="gray">
          Replay the required getting started walkthrough.
        </Text>
      </Flex>

      </main>
    </div>
  );
}
