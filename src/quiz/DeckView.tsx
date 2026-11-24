import { useEffect, useState } from 'react';
import { Button } from '@radix-ui/themes';
import { ClipboardIcon } from '@radix-ui/react-icons';
import { noteTitle } from '../vault/fileTree';
import type { PptxSlide } from './pptxContext';
import { loadQuizSourceSlides, type QuizSourceStore } from './quizSources';

/** Read-only outline of a slide deck (titles, text, speaker notes) with a quiz shortcut. */
export function DeckView({
  path,
  store,
  onCreateQuiz,
}: {
  path: string;
  store: QuizSourceStore | null;
  onCreateQuiz: () => void;
}) {
  const [slides, setSlides] = useState<PptxSlide[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    setSlides(null);
    setError('');
    if (!store) {
      setError('Open a vault to read this deck.');
      return;
    }
    loadQuizSourceSlides(store, path).then(
      (loaded) => {
        if (!disposed) setSlides(loaded);
      },
      (cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'Could not open this deck.');
      },
    );
    return () => {
      disposed = true;
    };
  }, [path, store]);

  const imageOnly = slides?.filter((slide) => !slide.title && !slide.lines.length && !slide.notes).length ?? 0;

  return (
    <div className="deck-view">
      <header className="deck-view-header">
        <div>
          <h1>{noteTitle(path)}</h1>
          <p>
            {slides
              ? `${slides.length} slides${imageOnly ? ` · ${imageOnly} with images only (not used in quizzes yet)` : ''}`
              : error || 'Reading slides…'}
          </p>
        </div>
        <Button highContrast onClick={onCreateQuiz} disabled={!slides}>
          <ClipboardIcon /> Create quiz
        </Button>
      </header>
      {slides && (
        <ol className="deck-view-slides">
          {slides.map((slide) => (
            <li key={slide.number} className="deck-view-slide">
              <span className="deck-view-number">{slide.number}</span>
              <div>
                <h2>{slide.title || (slide.imageCount ? 'Image slide' : 'Untitled slide')}</h2>
                {slide.lines.length > 0 && (
                  <ul>
                    {slide.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
                {slide.notes && <p className="deck-view-notes">Notes: {slide.notes}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
