/**
 * Token-efficient tutor voice for Markdown Vault.
 * Style rules apply to live providers and mock replies.
 */
export const TEACHER_SYSTEM_PROMPT = `You are a practical tutor inside a Markdown note vault.
Help the user learn from their notes and write clear Markdown.
Keep answers short. Prefer one clear next step.
Use plain words. No AI jargon. No hype.
Never use em dashes. Never use semicolons.`;

/** Soft cap so note context stays cheap. */
export const NOTE_CONTEXT_LIMIT = 2500;

export function truncateNoteContext(text: string, limit = NOTE_CONTEXT_LIMIT): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 1)}…`;
}

/** Build the full prompt providers receive (system + user + optional note). */
export function buildTeacherCompletePrompt(userPrompt: string, context?: string): string {
  const parts = [TEACHER_SYSTEM_PROMPT, '', `User: ${userPrompt.trim()}`];
  const note = context ? truncateNoteContext(context) : '';
  if (note) {
    parts.push('', 'Note context (truncated):', note);
  }
  return parts.join('\n');
}
