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

### Key points

- One idea a strong answer must cover
- Another idea, phrased as a short bullet

## Q4 · code

kind: predict-output

What does this program print?

\`\`\`python
def total(xs):
    return sum(x * 2 for x in xs)

print(total([1, 2, 3]))
\`\`\`

### Answer

12

### Why

Each element is doubled (2, 4, 6) and then summed.

Hard rules:
1. Follow the requested counts for mcq, cloze, open, and code exactly when given.
2. MCQ options must NOT start with A), B), C), D) or similar letters. Plain option text only.
3. Exactly one [x] correct option per MCQ unless the stem clearly requires multi-select.
4. Do not make the correct MCQ option the longest option by default. Vary lengths.
5. Distractors must be plausible misconceptions, not joke answers.
6. Ground every item in the provided note context when present. Do not invent unrelated topics.
7. Cloze questions must follow the CLOZE RULES below.
8. Rubric must be a single quoted line in frontmatter.
9. Title must start with "Quiz ".
10. Match the requested difficulty (easy = recall, medium = application, hard = transfer / edge cases).

CLOZE RULES (the student fills blanks from memory, so the sentence itself must make the answer derivable):
- Write a self-contained sentence that carries enough context to identify the answer: state the concept, purpose, or relationship around the blank. A reader who understood the note should be able to answer without having seen the exact wording.
- Blank ONE key term per question, at most two, and only when they are independent. Never blank both sides of a relationship.
- Blank only meaningful terms: names, technical vocabulary, numbers, causes, outcomes. Never blank articles, verbs like "is", generic words, or anything guessable from grammar alone.
- Never lift a sentence verbatim from the note if it depends on surrounding text ("this", "it", "as above"). Rewrite it so it stands alone.
- The answer inside {{ }} is 1-3 words, in its most canonical form, with no trailing punctuation. Prefer a single unambiguous term, so that a correct answer has few valid phrasings.
- Cue the answer's category in the sentence when it could be ambiguous ("the data structure that...", "the year...", "the protocol used for...").
- Put the blank late in the sentence, after the clues, not at the start.
- Avoid blanks with several equally valid answers. If that is unavoidable, choose the term the note uses.
- Below each cloze, add a "### Answer" section with a one-line explanation of why the answer fits, so the grader can accept valid alternatives.

CODE RULES (code-reading questions test whether the student can READ and reason about code, not write it):
- Use "## Qn · code" with a "kind:" line, then the prompt, then exactly one fenced snippet, then "### Answer" and "### Why".
- kind is one of:
  - predict-output: "What does this print?" The Answer is ONLY the exact stdout, nothing else. The code will be executed to check it.
  - find-bug: the snippet contains exactly one realistic bug (off-by-one, wrong operator, mutation of shared state …). Answer: the bug and its fix in one or two sentences.
  - complexity: the Answer is the Big-O with a one-line reason.
  - scale: a snippet (or a short scenario with no snippet) that works fine on small input, and a prompt asking what happens when the input grows dramatically (1000x, no longer fits in memory, arrives as an endless stream, millions of concurrent users) and what you would change. Base it on a real scaling flaw: loading everything into memory (list(), readlines(), read()), nested loops or repeated "in list" lookups, sorting everything to find the top k, string concatenation in a loop, unbounded caches or queues, deep recursion. The Answer is a model explanation in 3-5 sentences that names the bottleneck and the fix (generator / streaming, chunking, heap, hash set, external sort, bounded cache, backpressure). The student must reason, so never name the flaw in the prompt.
- Language: python or typescript; prefer the language the note uses.
- Snippets are 4-15 lines, self-contained, and derive from the concepts in the note. Never invent unrelated topics.
- predict-output snippets MUST be deterministic and standard-library only: no input(), randomness, time, network, files, or environment access. Print results with print() / console.log().
- Add a "### Key points" section (3-5 short bullets) to every open question and to code questions of kind find-bug, complexity, and scale. Each bullet is one idea a strong answer must cover, such as the bottleneck, the reason it matters, or the fix. Equivalent solutions count, so state ideas, not exact wording. Never add Key points to predict-output.
- Vary kinds across code questions when more than one is requested, and include at least one scale question when two or more are requested.
- Do not put the answer or hints in comments inside the snippet.

Good: "A {{hash map}} stores key-value pairs and gives average O(1) lookup by hashing each key to a bucket."
Bad: "A hash map {{stores}} key-value pairs and gives {{average}} O(1) lookup." (trivial blanks)
Bad: "The {{third}} step is to validate it." (no context, unanswerable from memory)`;

export function buildQuizGenerationUserPrompt(input: {
  topic: string;
  noteContext?: string;
  source?: string;
  sources?: string[];
  types?: string[];
  mcqCount?: number;
  clozeCount?: number;
  openCount?: number;
  codeCount?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  customRubric?: string;
}): string {
  const topic = input.topic.trim() || 'Untitled';
  const mcqCount = Math.max(0, input.mcqCount ?? 0);
  const clozeCount = Math.max(0, input.clozeCount ?? 0);
  const openCount = Math.max(0, input.openCount ?? 0);
  const codeCount = Math.max(0, input.codeCount ?? 0);
  const hasCounts = mcqCount + clozeCount + openCount + codeCount > 0;
  const types =
    input.types && input.types.length > 0
      ? input.types.join(', ')
      : hasCounts
        ? [
            mcqCount > 0 ? 'mcq' : null,
            clozeCount > 0 ? 'cloze' : null,
            openCount > 0 ? 'open' : null,
            codeCount > 0 ? 'code' : null,
          ]
            .filter(Boolean)
            .join(', ')
        : 'mcq, cloze, open, code';
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
      `Exact composition: ${mcqCount} mcq, ${clozeCount} cloze, ${openCount} open, ${codeCount} code (total ${mcqCount + clozeCount + openCount + codeCount}).`,
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
