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

function keyPointLines(points: string[] | undefined): string[] {
  return points?.length ? ['', '### Key points', '', ...points.map((point) => `- ${point}`)] : [];
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
    const explanation = question.explanation?.trim();
    return `${heading}\n\n${question.prompt.trim()}\n${explanation ? `\n### Answer\n\n${explanation}\n` : ''}`;
  }
  if (question.type === 'code') {
    const meta = [`kind: ${question.kind}`, ...(question.verified ? ['verified: true'] : [])].join('\n');
    const fence = question.snippet.includes('```') ? '~~~~' : '```';
    const why = question.explanation?.trim();
    return [
      heading,
      '',
      meta,
      '',
      question.prompt.trim(),
      '',
      ...(question.snippet.trim()
        ? [`${fence}${question.language}`, question.snippet.replace(/\s+$/, ''), fence, '']
        : []),
      '### Answer',
      '',
      question.expected.trim(),
      ...keyPointLines(question.keyPoints),
      ...(why ? ['', '### Why', '', why] : []),
      '',
    ].join('\n');
  }
  return `${heading}\n\n${question.prompt.trim()}\n\n### Answer\n\n${question.answer.trim()}\n${keyPointLines(question.keyPoints).join('\n')}${question.keyPoints?.length ? '\n' : ''}`;
}

/** Serialize a QuizDocument to the vault markdown schema. */
export function serializeQuizMarkdown(doc: QuizDocument): string {
  const parts = [serializeFrontmatter(doc), `# ${doc.title.trim()}`, ''];
  doc.questions.forEach((q, i) => {
    parts.push(serializeQuestion(q, i));
  });
  return parts.join('\n').trimEnd() + '\n';
}
