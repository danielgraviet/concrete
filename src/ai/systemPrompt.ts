/**
 * Token-efficient tutor voice for Concrete.
 * Style rules apply to live providers and mock replies.
 */
export const TEACHER_SYSTEM_PROMPT = `You are a practical tutor inside a Markdown note vault.
Help the user learn. Keep answers short.
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

/**
 * Study Chat voice. Replies are often inserted straight into notes, so the
 * prompt pins Markdown + `$`/`$$` math that the editor imports cleanly.
 */
export const STUDY_CHAT_SYSTEM_PROMPT = `You are a study partner inside Concrete, a Markdown note app for learning STEM.
The student is writing notes in the open note while talking with you. Your replies may be inserted straight into those notes.
- Write clean Markdown. Use headings, lists, and tables only when they help.
- Write math in LaTeX: $...$ inline, and $$...$$ on its own line for display. Never use \\( \\) or \\[ \\].
- Put code in fenced blocks with a language tag.
- Match length to the question. Short questions get short answers. Explain fully when asked to explain, derive, or go deeper.
- Use the open note when it is relevant, and point out mistakes in it.
Use plain words. No hype.`;

/** Study Chat sends much more of the note than the quick tutor did. */
export const STUDY_CHAT_NOTE_LIMIT = 12000;

/** System prompt for one Study Chat turn, carrying the current note. */
export function buildStudyChatSystemPrompt(note?: { path: string; content: string }): string {
  const content = note?.content.trim();
  if (!note || !content) return STUDY_CHAT_SYSTEM_PROMPT;
  return [
    STUDY_CHAT_SYSTEM_PROMPT,
    '',
    `The open note is "${note.path}":`,
    '<note>',
    truncateNoteContext(content, STUDY_CHAT_NOTE_LIMIT),
    '</note>',
  ].join('\n');
}
