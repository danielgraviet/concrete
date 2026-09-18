import { splitFrontmatter } from '../meta/frontmatter';
import { CODE_KINDS } from './types';
import type {
  ClozeQuestion,
  CodeKind,
  CodeQuestion,
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
  const answerIdx = bodyLines.findIndex((line) => /^###\s+Answer\s*$/i.test(line));
  const promptLines = answerIdx >= 0 ? bodyLines.slice(0, answerIdx) : bodyLines;
  const explanation = answerIdx >= 0 ? bodyLines.slice(answerIdx + 1).join('\n').trim() : '';
  const text = [prompt, ...promptLines].filter(Boolean).join('\n').trim();
  const { answers } = extractClozeAnswers(text);
  return { id, type: 'cloze', prompt: text, answers, ...(explanation ? { explanation } : {}) };
}

const FENCE_OPEN = /^\s*(```+|~~~+)\s*([\w+#-]*)/;

type Sections = { head: string[]; sections: Record<string, string[]> };

/**
 * Split a question body on `### Name` headings for the given names, ignoring
 * headings inside code fences. `head` is everything before the first section.
 */
function splitSections(lines: string[], names: string[]): Sections {
  const wanted = new Map(names.map((name) => [name.toLowerCase(), name.toLowerCase()]));
  const result: Sections = { head: [], sections: {} };
  let current: string[] = result.head;
  let fence: string | null = null;
  for (const line of lines) {
    const open = FENCE_OPEN.exec(line);
    if (fence) {
      if (line.trim().startsWith(fence)) fence = null;
    } else if (open) {
      fence = open[1];
    } else {
      const heading = /^###\s+(.+?)\s*$/.exec(line);
      const key = heading ? wanted.get(heading[1].toLowerCase()) : undefined;
      if (key) {
        current = [];
        result.sections[key] = current;
        continue;
      }
    }
    current.push(line);
  }
  return result;
}

function parseKeyPoints(lines: string[] | undefined): string[] | undefined {
  const points = (lines ?? [])
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
  return points.length ? points : undefined;
}

function parseCodeBlock(id: string, prompt: string, bodyLines: string[]): CodeQuestion {
  const lines = [...bodyLines];
  let kind: CodeKind = 'predict-output';
  let verified = false;
  // Leading `key: value` metadata lines.
  while (lines.length) {
    if (!lines[0].trim()) {
      lines.shift();
      continue;
    }
    const meta = /^(kind|verified):\s*(\S+)\s*$/i.exec(lines[0]);
    if (!meta) break;
    const value = meta[2].toLowerCase();
    if (meta[1].toLowerCase() === 'kind' && (CODE_KINDS as readonly string[]).includes(value)) {
      kind = value as CodeKind;
    }
    if (meta[1].toLowerCase() === 'verified') verified = value === 'true';
    lines.shift();
  }

  const { head, sections } = splitSections(lines, ['Answer', 'Key points', 'Why']);
  const expected = (sections.answer ?? []).join('\n').trim();
  const explanation = (sections.why ?? []).join('\n').trim();
  const keyPoints = parseKeyPoints(sections['key points']);

  // First fenced block is the snippet (optional for scale scenarios); the rest is the prompt.
  let language = '';
  let snippet = '';
  let hasSnippet = false;
  const promptLines: string[] = [];
  for (let i = 0; i < head.length; i += 1) {
    const open = FENCE_OPEN.exec(head[i]);
    if (open && !hasSnippet) {
      hasSnippet = true;
      language = open[2] || 'text';
      const body: string[] = [];
      i += 1;
      while (i < head.length && !head[i].trim().startsWith(open[1])) {
        body.push(head[i]);
        i += 1;
      }
      snippet = body.join('\n');
      continue;
    }
    promptLines.push(head[i]);
  }

  return {
    id,
    type: 'code',
    kind,
    language: language || 'python',
    prompt: [prompt, ...promptLines].filter(Boolean).join('\n').trim(),
    snippet,
    expected,
    ...(keyPoints ? { keyPoints } : {}),
    ...(explanation ? { explanation } : {}),
    ...(verified ? { verified: true } : {}),
  };
}

function parseOpenBlock(id: string, prompt: string, bodyLines: string[]): OpenQuestion {
  const { head, sections } = splitSections(bodyLines, ['Answer', 'Key points']);
  const fullPrompt = [prompt, ...head].filter(Boolean).join('\n').trim();
  const keyPoints = parseKeyPoints(sections['key points']);
  return {
    id,
    type: 'open',
    prompt: fullPrompt,
    answer: (sections.answer ?? []).join('\n').trim(),
    ...(keyPoints ? { keyPoints } : {}),
  };
}

function parseHeadingType(heading: string): { type: QuizQuestion['type'] | null; prompt: string } {
  // ## Q1 · mcq   or  ## Q1 · cloze  or ## Q1 · open
  const typed = /^Q\d+\s*[·•\-–—]\s*(mcq|cloze|open|code)\s*$/i.exec(heading.trim());
  if (typed) {
    return { type: typed[1].toLowerCase() as QuizQuestion['type'], prompt: '' };
  }
  const typedInline =
    /^Q\d+\s*[·•\-–—]\s*(mcq|cloze|open|code)\s+(.+)$/i.exec(heading.trim());
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
    // Headings inside a code fence (e.g. Python comments) are part of the body.
    let fence: string | null = null;
    while (i < lines.length) {
      const fenceOpen = FENCE_OPEN.exec(lines[i]);
      if (fence) {
        if (lines[i].trim().startsWith(fence)) fence = null;
      } else if (fenceOpen) {
        fence = fenceOpen[1];
      } else if (/^##\s+/.test(lines[i]) || /^#\s+/.test(lines[i])) {
        break;
      }
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
    } else if (type === 'code') {
      questions.push(parseCodeBlock(id, promptSeed, bodyLines));
    } else if (type === 'cloze') {
      questions.push(parseClozeBlock(id, promptSeed, bodyLines));
    } else {
      questions.push(parseOpenBlock(id, promptSeed, bodyLines));
    }
  }

  if (!title) title = 'Quiz';

  return { title, source, rubric, questions };
}
