import { describe, expect, it } from 'vitest';
import { visibleSettingsSections } from './sections';

const ids = (caps: { localAgents: boolean; localTelemetry: boolean }) =>
  visibleSettingsSections(caps).map(([id]) => id);

describe('visibleSettingsSections', () => {
  it('shows every section when the platform has local agents and telemetry (desktop)', () => {
    expect(ids({ localAgents: true, localTelemetry: true })).toEqual([
      'appearance', 'editor', 'quiz', 'review', 'ai', 'agent', 'vault', 'activity',
    ]);
  });

  it('hides Agent and AI Activity when those capabilities are missing (web)', () => {
    expect(ids({ localAgents: false, localTelemetry: false })).toEqual([
      'appearance', 'editor', 'quiz', 'review', 'ai', 'vault',
    ]);
  });

  it('gates each section on its own capability', () => {
    expect(ids({ localAgents: true, localTelemetry: false })).toContain('agent');
    expect(ids({ localAgents: true, localTelemetry: false })).not.toContain('activity');
    expect(ids({ localAgents: false, localTelemetry: true })).not.toContain('agent');
    expect(ids({ localAgents: false, localTelemetry: true })).toContain('activity');
  });
});
