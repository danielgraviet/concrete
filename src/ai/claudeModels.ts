/** Claude Code model aliases; each resolves to the latest model in its tier. */

export type ClaudeModelOption = {
  id: string;
  label: string;
};

export const CLAUDE_MODEL_DEFAULT = 'sonnet';

export const CLAUDE_MODEL_OPTIONS: ClaudeModelOption[] = [
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'opus', label: 'Opus' },
];

export function resolveClaudeModelId(value: unknown): string {
  return CLAUDE_MODEL_OPTIONS.some((option) => option.id === value)
    ? (value as string)
    : CLAUDE_MODEL_DEFAULT;
}

export function claudeModelLabel(modelId: string): string {
  return CLAUDE_MODEL_OPTIONS.find((option) => option.id === modelId)?.label ?? modelId;
}
