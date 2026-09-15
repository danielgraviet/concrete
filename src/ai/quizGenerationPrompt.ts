/**
 * Prompt engineering for OpenRouter quiz generation.
 * Output must match the vault quiz markdown schema (no A/B/C letters in options).
 */

export const QUIZ_GENERATION_SYSTEM_PROMPT = `You generate study quizzes as Markdown for a local note vault.

Return ONLY valid quiz Markdown. No preamble, no explanation, no code fences unless the whole document is inside one markdown fence.

Required shape:

---
type: quiz
source: <origin note path or omit>
rubric: "<one-line grading rubric>"
---

# Quiz <Title>

## Q1 · mcq

<question stem>

- [ ] <distractor>
- [x] <correct answer>
- [ ] <distractor>
- [ ] <distractor>

## Q2 · cloze

Sentence with {{exact answer}} blanks like this.

## Q3 · open

Open-ended prompt.

### Answer

Reference answer for the grader.

Hard rules:
1. Follow the requested counts for mcq, cloze, and open exactly when given.
2. MCQ options must NOT start with A), B), C), D) or similar letters. Plain option text only.
3. Exactly one [x] correct option per MCQ unless the stem clearly requires multi-select.
4. Do not make the correct MCQ option the longest option by default. Vary lengths.
5. Distractors must be plausible misconceptions, not joke answers.
6. Ground every item in the provided note context when present. Do not invent unrelated topics.
7. Cloze answers inside {{ }} must be short (1-5 words).
8. Rubric must be a single quoted line in frontmatter.
9. Title must start with "Quiz ".
10. Match the requested difficulty (easy = recall, medium = application, hard = transfer / edge cases).`;

export function buildQuizGenerationUserPrompt(input: {
  topic: string;
  noteContext?: string;
  source?: string;
  sources?: string[];
  types?: string[];
  mcqCount?: number;
  clozeCount?: number;
  openCount?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  customRubric?: string;
}): string {
  const topic = input.topic.trim() || 'Untitled';
  const mcqCount = Math.max(0, input.mcqCount ?? 0);
  const clozeCount = Math.max(0, input.clozeCount ?? 0);
  const openCount = Math.max(0, input.openCount ?? 0);
  const hasCounts = mcqCount + clozeCount + openCount > 0;
  const types =
    input.types && input.types.length > 0
      ? input.types.join(', ')
      : hasCounts
        ? [
            mcqCount > 0 ? 'mcq' : null,
            clozeCount > 0 ? 'cloze' : null,
            openCount > 0 ? 'open' : null,
          ]
            .filter(Boolean)
            .join(', ')
        : 'mcq, cloze, open';
  const sources =
    input.sources && input.sources.length > 0
      ? input.sources
      : input.source
        ? [input.source]
        : [];
  const difficulty = input.difficulty || 'medium';

  const parts = [
    `Create a quiz titled "Quiz ${topic.replace(/^Quiz\s+/i, '')}".`,
    `Question types to include: ${types}.`,
    `Difficulty: ${difficulty}.`,
    'Base every question on the source note(s) below. Prefer retrieval and application over trivia.',
  ];

  if (hasCounts) {
    parts.push(
      `Exact composition: ${mcqCount} mcq, ${clozeCount} cloze, ${openCount} open (total ${mcqCount + clozeCount + openCount}).`,
    );
  }

  if (input.customRubric?.trim()) {
    parts.push(
      `Set frontmatter rubric exactly to: "${input.customRubric.trim().replace(/"/g, "'")}"`,
    );
  }

  if (sources.length === 1) {
    parts.push(`Set frontmatter source to: ${sources[0]}`);
  } else if (sources.length > 1) {
    parts.push(
      `Set frontmatter source to the primary note: ${sources[0]}`,
      `Also cover these notes: ${sources.slice(1).join(', ')}`,
    );
  }

  if (input.noteContext?.trim()) {
    parts.push(
      '',
      'Source note content (authoritative — do not invent outside this):',
      '-----',
      input.noteContext.trim(),
      '-----',
    );
  } else {
    parts.push(
      '',
      'No note context was provided. Use general accurate knowledge for the topic, keep difficulty introductory.',
    );
  }

  parts.push(
    '',
    'Remember: output only the quiz Markdown document. No commentary.',
  );

  return parts.join('\n');
}
