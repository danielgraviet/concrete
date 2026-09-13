import { splitFrontmatter } from '../meta/frontmatter';
import type {
  ClozeQuestion,
  McqOption,
  McqQuestion,
  OpenQuestion,
  QuizDocument,
  QuizQuestion,
} from './types';

function newId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function extractClozeAnswers(prompt: string): { answers: string[] } {
  const answers: string[] = [];
  prompt.replace(/\{\{([^}]+)\}\}/g, (_, raw: string) => {
    answers.push(raw.trim());
    return '';
  });
  return { answers };
}

function parseMcqBlock(id: string, prompt: string, bodyLines: string[]): McqQuestion {
  const options: McqOption[] = [];
  const promptLines: string[] = [];
  let optionIndex = 0;

  for (const line of bodyLines) {
    const match = /^-\s*\[([ xX])\]\s*(.+)$/.exec(line);
    if (match) {
      options.push({
        id: `${id}-opt-${optionIndex + 1}`,
        text: match[2].trim(),
        correct: match[1].toLowerCase() === 'x',
      });
      optionIndex += 1;
      continue;
    }
    if (options.length === 0) promptLines.push(line);
  }

  const fullPrompt = [prompt, ...promptLines].filter(Boolean).join('\n').trim();
  return { id, type: 'mcq', prompt: fullPrompt, options };
}

function parseClozeBlock(id: string, prompt: string, bodyLines: string[]): ClozeQuestion {
  const text = [prompt, ...bodyLines].filter(Boolean).join('\n').trim();
  const { answers } = extractClozeAnswers(text);
  return { id, type: 'cloze', prompt: text, answers };
}

function parseOpenBlock(id: string, prompt: string, bodyLines: string[]): OpenQuestion {
  const answerIdx = bodyLines.findIndex((line) => /^###\s+Answer\s*$/i.test(line));
  let questionLines = bodyLines;
  let answer = '';
  if (answerIdx >= 0) {
    questionLines = bodyLines.slice(0, answerIdx);
    answer = bodyLines.slice(answerIdx + 1).join('\n').trim();
  }
  const fullPrompt = [prompt, ...questionLines].filter(Boolean).join('\n').trim();
  return { id, type: 'open', prompt: fullPrompt, answer };
}

function parseHeadingType(heading: string): { type: QuizQuestion['type'] | null; prompt: string } {
  // ## Q1 · mcq   or  ## Q1 · cloze  or ## Q1 · open
  const typed = /^Q\d+\s*[·•\-–—]\s*(mcq|cloze|open)\s*$/i.exec(heading.trim());
  if (typed) {
    return { type: typed[1].toLowerCase() as QuizQuestion['type'], prompt: '' };
  }
  const typedInline =
    /^Q\d+\s*[·•\-–—]\s*(mcq|cloze|open)\s+(.+)$/i.exec(heading.trim());
  if (typedInline) {
    return {
      type: typedInline[1].toLowerCase() as QuizQuestion['type'],
      prompt: typedInline[2].trim(),
    };
  }
  // Fallback: infer from body later
  return { type: null, prompt: heading.trim() };
}

function inferType(bodyLines: string[]): QuizQuestion['type'] {
  if (bodyLines.some((line) => /^-\s*\[[ xX]\]/.test(line))) return 'mcq';
  const joined = bodyLines.join('\n');
  if (/\{\{[^}]+\}\}/.test(joined)) return 'cloze';
  return 'open';
}

/**
 * Parse quiz markdown (frontmatter + ## Qn · type sections) into a QuizDocument.
 */
export function parseQuizMarkdown(markdown: string): QuizDocument {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const lines = body.replace(/\r\n/g, '\n').split('\n');

  let title = typeof frontmatter.title === 'string' ? frontmatter.title : '';
  const source = typeof frontmatter.source === 'string' ? frontmatter.source : undefined;
  let rubric =
    typeof frontmatter.rubric === 'string'
      ? frontmatter.rubric
      : 'Score correctness, conceptual precision, and use of required terms.';

  // Support multi-line rubric stored as literal `|` placeholder from simple yaml
  if (rubric === '|' || rubric === '>') {
    rubric =
      'Score correctness, conceptual precision, and use of required terms. Partial credit allowed.';
  }

  const questions: QuizQuestion[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1 && !title) {
      title = h1[1].trim();
      i += 1;
      continue;
    }

    const h2 = /^##\s+(.+)$/.exec(line);
    if (!h2) {
      i += 1;
      continue;
    }

    const heading = h2[1];
    i += 1;
    const bodyLines: string[] = [];
    while (i < lines.length && !/^##\s+/.test(lines[i]) && !/^#\s+/.test(lines[i])) {
      bodyLines.push(lines[i]);
      i += 1;
    }

    // trim trailing blanks
    while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) {
      bodyLines.pop();
    }
    while (bodyLines.length && !bodyLines[0].trim()) {
      bodyLines.shift();
    }

    const parsedHeading = parseHeadingType(heading);
    const type = parsedHeading.type ?? inferType(bodyLines);
    const id = newId('q', questions.length);
    const promptSeed = parsedHeading.prompt;

    if (type === 'mcq') {
      questions.push(parseMcqBlock(id, promptSeed, bodyLines));
    } else if (type === 'cloze') {
      questions.push(parseClozeBlock(id, promptSeed, bodyLines));
    } else {
      questions.push(parseOpenBlock(id, promptSeed, bodyLines));
    }
  }

  if (!title) title = 'Quiz';

  return { title, source, rubric, questions };
}
