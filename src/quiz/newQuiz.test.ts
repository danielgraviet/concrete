import { describe, expect, it } from 'vitest';
import {
  QUIZ_SIZE_PRESETS,
  canAddAsQuizSource,
  quizSaveFolder,
  scaleQuizCounts,
  sourceStatusLabel,
} from './newQuiz';

/** State-based tests for the New quiz dialog's pure helpers: inputs in, values out. */

const total = (counts: { mcqCount: number; clozeCount: number; openCount: number; codeCount: number }) =>
  counts.mcqCount + counts.clozeCount + counts.openCount + counts.codeCount;

describe('QUIZ_SIZE_PRESETS', () => {
  it('offers Quick 10, Standard 20 and Exam 40', () => {
    expect(QUIZ_SIZE_PRESETS.map((preset) => [preset.label, preset.total])).toEqual([
      ['Quick', 10],
      ['Standard', 20],
      ['Exam', 40],
    ]);
  });
});

describe('scaleQuizCounts', () => {
  it('keeps the detected mix while hitting the chosen total exactly', () => {
    const scaled = scaleQuizCounts({ mcqCount: 6, clozeCount: 2, openCount: 2, codeCount: 0 }, 20);

    expect(scaled).toEqual({ mcqCount: 12, clozeCount: 4, openCount: 4, codeCount: 0 });
  });

  it('distributes rounding leftovers so the total is still exact', () => {
    const scaled = scaleQuizCounts({ mcqCount: 1, clozeCount: 1, openCount: 1, codeCount: 0 }, 10);

    expect(total(scaled)).toBe(10);
    expect(scaled.codeCount).toBe(0);
    for (const n of [scaled.mcqCount, scaled.clozeCount, scaled.openCount]) {
      expect(n === 3 || n === 4).toBe(true);
    }
  });

  it('never adds a question type the detected mix left out', () => {
    const scaled = scaleQuizCounts({ mcqCount: 3, clozeCount: 0, openCount: 0, codeCount: 1 }, 40);

    expect(scaled).toEqual({ mcqCount: 30, clozeCount: 0, openCount: 0, codeCount: 10 });
  });

  it('falls back to multiple choice when there is no mix yet', () => {
    expect(scaleQuizCounts({ mcqCount: 0, clozeCount: 0, openCount: 0, codeCount: 0 }, 10)).toEqual({
      mcqCount: 10,
      clozeCount: 0,
      openCount: 0,
      codeCount: 0,
    });
  });
});

describe('quizSaveFolder', () => {
  it('saves next to a note source', () => {
    expect(quizSaveFolder('Biology/Week 2/cells.md', 'Inbox')).toBe('Biology/Week 2');
  });

  it('does not file quizzes inside Sources/; uses the folder the user is working in', () => {
    expect(quizSaveFolder('Sources/cell-membranes.pptx', 'Biology')).toBe('Biology');
    expect(quizSaveFolder('Sources/Lecture 3.pdf', '')).toBe('');
  });

  it('uses the working folder for a source at the vault root', () => {
    expect(quizSaveFolder('cells.md', 'Biology')).toBe('Biology');
  });
});

describe('sourceStatusLabel', () => {
  it('counts slides for decks', () => {
    expect(sourceStatusLabel({ kind: 'pptx', unitCount: 24 })).toBe('24 slides');
    expect(sourceStatusLabel({ kind: 'pptx', unitCount: 1 })).toBe('1 slide');
  });

  it('names PDFs without a page count', () => {
    expect(sourceStatusLabel({ kind: 'pdf', unitCount: null })).toBe('PDF');
  });
});

describe('canAddAsQuizSource', () => {
  it('accepts decks and PDFs in any letter case', () => {
    expect(canAddAsQuizSource('Week 1.pptx')).toBe(true);
    expect(canAddAsQuizSource('Week 1.PDF')).toBe(true);
  });

  it('rejects other file types', () => {
    expect(canAddAsQuizSource('Week 1.key')).toBe(false);
    expect(canAddAsQuizSource('Week 1.docx')).toBe(false);
    expect(canAddAsQuizSource('pptx')).toBe(false);
  });
});
