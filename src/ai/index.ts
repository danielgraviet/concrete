export type { CompleteRequest, AiProvider } from './types';
export { MockAiProvider } from './MockAiProvider';
export { LocalEchoProvider } from './LocalEchoProvider';
export { AiClient, aiClient } from './AiClient';
export { AiPanel } from './AiPanel';
export { AiOrb } from './AiOrb';
export {
  TEACHER_SYSTEM_PROMPT,
  NOTE_CONTEXT_LIMIT,
  truncateNoteContext,
  buildTeacherCompletePrompt,
} from './systemPrompt';
export { setSlashAiHandler, handoffSlashToAi } from './slashHandoff';
export type { SlashAiHandler } from './slashHandoff';
