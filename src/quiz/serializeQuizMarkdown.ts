import type { QuizDocument, QuizQuestion } from './types';

function yamlScalar(value: string): string {
  if (/[:#\n]|^\s|\s$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function serializeFrontmatter(doc: QuizDocument): string {
  const lines = ['---', 'type: quiz'];
  if (doc.source) lines.push(`source: ${yamlScalar(doc.source)}`);
  // Single-line quoted string so the simple YAML parser round-trips.
  const rubric = doc.rubric.trim().replace(/\s*\n\s*/g, ' ');
  lines.push(`rubric: ${JSON.stringify(rubric)}`);
  lines.push('---', '');
  return lines.join('\n');
}

function serializeQuestion(question: QuizQuestion, index: number): string {
  const heading = `## Q${index + 1} · ${question.type}`;
  if (question.type === 'mcq') {
    const options = question.options
      .map((opt) => `- [${opt.correct ? 'x' : ' '}] ${opt.text}`)
      .join('\n');
    return `${heading}\n\n${question.prompt.trim()}\n\n${options}\n`;
  }
  if (question.type === 'cloze') {
    return `${heading}\n\n${question.prompt.trim()}\n`;
  }
  return `${heading}\n\n${question.prompt.trim()}\n\n### Answer\n\n${question.answer.trim()}\n`;
}

/** Serialize a QuizDocument to the vault markdown schema. */
export function serializeQuizMarkdown(doc: QuizDocument): string {
  const parts = [serializeFrontmatter(doc), `# ${doc.title.trim()}`, ''];
  doc.questions.forEach((q, i) => {
    parts.push(serializeQuestion(q, i));
  });
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
