import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NewQuizDialog } from './NewQuizDialog';
import type { QuizGenerationSettings } from '../settings';

/** First-render state of the New quiz dialog (static markup, no interaction). */

const settings = {
  mcqCount: 6,
  clozeCount: 2,
  openCount: 2,
  codeCount: 0,
  difficulty: 'medium',
} as unknown as QuizGenerationSettings;

function render(defaultSourcePath: string) {
  return renderToStaticMarkup(
    <NewQuizDialog
      files={['Biology/cells.md']}
      pdfFiles={['Sources/cell-membranes.pptx']}
      existingSourceQuizzes={new Map()}
      quizSourceIndexReady
      defaultSourcePath={defaultSourcePath}
      defaultSettings={settings}
      onCancel={() => {}}
      onConfirm={() => {}}
      onAnalyzeAuto={async () => ({ mcqCount: 1, clozeCount: 0, openCount: 0, codeCount: 0, sourceIntent: 'generate' })}
      onAddFile={async () => ({ path: 'Sources/x.pdf', kind: 'pdf', unitCount: null, storedOriginal: true })}
    />,
  );
}

const generateButton = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>).)*Generate quiz<\/button>/s)?.[0] ?? '';

describe('NewQuizDialog', () => {
  it('opens from home ready for a drop, with nothing selected and Generate disabled', () => {
    const html = render('');

    expect(html).toContain('New quiz');
    expect(html).toContain('Drop slides or PDFs here');
    expect(html).toContain('accept=".pptx,');
    expect(html).toContain('Add a file or pick one from your vault.');
    expect(generateButton(html)).toContain('disabled');
  });

  it('defaults to Standard 20 with the settings mix scaled to fit', () => {
    const html = render('');

    expect(html).toContain('20 questions');
    expect(html).toContain('12 multiple choice, 4 cloze, 4 open');
  });

  it('keeps the vault list collapsed but names the preselected note', () => {
    const html = render('Biology/cells.md');

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('From your vault');
    expect(html).not.toContain('Biology/cells.md · current');
    expect(html).toContain('value="cells"');
  });
});
