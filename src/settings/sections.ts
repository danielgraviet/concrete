import type { BackendCapabilities } from '../backend/types';

export type SettingsSection =
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

/** Settings tabs this platform can back: Agent needs local agents, AI Activity needs local telemetry. */
export function visibleSettingsSections(
  capabilities: Pick<BackendCapabilities, 'localAgents' | 'localTelemetry'>,
): ReadonlyArray<readonly [SettingsSection, string]> {
  return SECTIONS.filter(([id]) =>
    id === 'agent' ? capabilities.localAgents : id === 'activity' ? capabilities.localTelemetry : true,
  );
}
