/** Curated cheap OpenRouter models for quiz generation / tutoring. */

export type OpenRouterModelOption = {
  id: string;
  label: string;
  description: string;
};

export const OPENROUTER_MODEL_DEEPSEEK_V4_FLASH =
  'deepseek/deepseek-v4-flash-0731';
export const OPENROUTER_MODEL_QWEN_FLASH = 'qwen/qwen3.7-flash';
export const OPENROUTER_MODEL_LUNA = 'openai/gpt-5.6-luna';
export const OPENROUTER_MODEL_GPT4O_MINI = 'openai/gpt-4o-mini';

/** Default live model for quiz generation and grading. */
export const OPENROUTER_MODEL_DEFAULT = OPENROUTER_MODEL_DEEPSEEK_V4_FLASH;

/** Cheap/fast model for Create Cards AI assist. */
export const CARD_GENERATION_MODEL = OPENROUTER_MODEL_QWEN_FLASH;

export const OPENROUTER_MODEL_OPTIONS: OpenRouterModelOption[] = [
  {
    id: OPENROUTER_MODEL_DEEPSEEK_V4_FLASH,
    label: 'DeepSeek V4 Flash',
    description: 'Fast & cheap · quiz default',
  },
  {
    id: OPENROUTER_MODEL_QWEN_FLASH,
    label: 'Qwen 3.7 Flash',
    description: 'Fast & cheap · Create Cards',
  },
  {
    id: OPENROUTER_MODEL_LUNA,
    label: 'GPT-5.6 Luna',
    description: 'OpenAI low-cost tier',
  },
  {
    id: OPENROUTER_MODEL_GPT4O_MINI,
    label: 'GPT-4o mini',
    description: 'Reliable OpenAI mini',
  },
];

export function isOpenRouterModelId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    OPENROUTER_MODEL_OPTIONS.some((option) => option.id === value)
  );
}

export function resolveOpenRouterModelId(value: unknown): string {
  return isOpenRouterModelId(value) ? value : OPENROUTER_MODEL_DEFAULT;
}

export function openRouterModelLabel(modelId: string): string {
  return (
    OPENROUTER_MODEL_OPTIONS.find((option) => option.id === modelId)?.label ??
    modelId
  );
}
