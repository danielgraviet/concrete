import type { ChatTurn } from '../types';
import type { StudyChatMessage } from './threadStore';

/** Markdown blockquote of a reply, for inserting it as a quote. */
export function asBlockquote(markdown: string): string {
  return markdown
    .trim()
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

/** What the model sees for a user turn: the attached excerpt, then the question. */
export function userTurnContent(message: StudyChatMessage): string {
  if (!message.quote) return message.text;
  return `About this part of my note:\n"""\n${message.quote}\n"""\n\n${message.text}`;
}

/**
 * Turns the model should see. Sessions span notes and modes, so a question
 * is marked when the user moved to another note, and agent requests are
 * labelled so the tutor knows what the agent was asked to change.
 * Logs and failed replies are left out.
 */
export function chatHistory(messages: StudyChatMessage[]): ChatTurn[] {
  let lastNote: string | undefined;
  return messages
    .filter((m) => m.role !== 'log' && !(m.role === 'assistant' && m.error))
    .map((m): ChatTurn => {
      if (m.role === 'assistant') return { role: 'assistant', content: m.text };
      const notes: string[] = [];
      if (m.notePath && m.notePath !== lastNote) notes.push(`(Now viewing note: ${m.notePath})`);
      if (m.mode === 'agent') notes.push('(Sent to the editing agent)');
      if (m.notePath) lastNote = m.notePath;
      return { role: 'user', content: [...notes, userTurnContent(m)].join('\n\n') };
    });
}
