import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { Flex, Heading, IconButton, Text } from '@radix-ui/themes';

export type ProductTourStep = {
  title: string;
  body: string[];
  target: string;
};

export const PRODUCT_TOUR_STEPS: ProductTourStep[] = [
  {
    title: 'Your vault is ready',
    body: [
      'Your vault is set to Documents/Concrete.',
      'Notes are plain Markdown files stored on your computer.',
      'Browse your notes and folders in the file tree.',
    ],
    target: '.sidebar .file-tree',
  },
  {
    title: 'Make a note',
    body: [
      'Click the highlighted plus button.',
      'Name your first note and Concrete will open it in the editor.',
    ],
    target: '.sidebar-heading-actions button[aria-label^="New note"]',
  },
  {
    title: 'Write your first note',
    body: [
      'Type /h1, then your note title.',
      'Type /quote, then a sentence.',
      'Type /mathblock, then an equation such as E = mc^2.',
    ],
    target: '.editor-wrap',
  },
  {
    title: 'Study with your notes',
    body: [
      'Open Study Chat to ask questions about the note you just wrote.',
      'The chat can use your open note as context while you work.',
    ],
    target: '.study-chat-launcher',
  },
  {
    title: 'Create a quiz from your notes',
    body: [
      'Choose the quiz icon on the left, next to Review, to start a quiz from your writing.',
      'Pick one or more notes, choose question types, and Concrete builds a quiz grounded in those sources.',
      'Your quiz is saved in the vault, and your results are tracked in Concrete.',
    ],
    target: '[data-tour="generate-quiz"]',
  },
  {
    title: 'Build a review habit',
    body: [
      'Review opens your flashcard queue.',
      'Create cards from a note to practice what you have learned.',
    ],
    target: '.rail button[aria-label^="Review"]',
  },
  {
    title: 'You’re ready to begin',
    body: [
      'Your notes stay in Documents/Concrete as portable Markdown files.',
      'Create another note and use [[wikilinks]] to connect related ideas.',
    ],
    target: '.sidebar-heading-actions button[aria-label^="New note"]',
  },
];

type Props = {
  stepIndex: number;
  onStepIndexChange: (index: number) => void;
  canAdvance: boolean;
  excludeWelcome: boolean;
  seededReviewCards: boolean;
  targetOverride?: string;
  onFinished: () => void;
};

/**
 * Required first-run walkthrough of Concrete's core actions.
 */
export function ProductTour({
  stepIndex,
  onStepIndexChange,
  canAdvance,
  excludeWelcome,
  seededReviewCards,
  targetOverride,
  onFinished,
}: Props) {
  const clamped = Math.max(0, Math.min(stepIndex, PRODUCT_TOUR_STEPS.length - 1));
  const step = PRODUCT_TOUR_STEPS[clamped];
  const body = clamped === 5 && seededReviewCards
    ? [
        'Review opens your flashcard queue.',
        'We added three sample cards so the queue is ready to try. Edit or delete them in Concrete Basics.',
      ]
    : step.body;
  const targetSelector = targetOverride ?? step.target;
  const isLast = clamped === PRODUCT_TOUR_STEPS.length - 1;
  const cardRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ left: 16, top: 16 });
  const [writeExerciseChecks, setWriteExerciseChecks] = useState([false, false, false]);
  const writeExerciseComplete = writeExerciseChecks.every(Boolean);

  useEffect(() => {
    if (clamped !== 2) return;
    const editor = document.querySelector<HTMLElement>('.editor-wrap');
    if (!editor) return;
    const readChecks = () => {
      if (excludeWelcome) {
        setWriteExerciseChecks([false, false, false]);
        return;
      }
      const hasMathBlock = [...editor.querySelectorAll<HTMLElement>('.mv-math-block')].some((block) => {
        const editing = block.querySelector<HTMLTextAreaElement>('.mv-math-input.block');
        const value = editing?.value.trim() ?? block.querySelector('.mv-math-render')?.textContent?.trim() ?? '';
        return Boolean(value) && value !== 'formula' && value !== '…';
      });
      setWriteExerciseChecks([
        Boolean(editor.querySelector('h1')),
        Boolean(editor.querySelector('blockquote')),
        hasMathBlock,
      ]);
    };
    readChecks();
    const observer = new MutationObserver(readChecks);
    observer.observe(editor, { childList: true, subtree: true, characterData: true });
    editor.addEventListener('input', readChecks, true);
    return () => {
      observer.disconnect();
      editor.removeEventListener('input', readChecks, true);
    };
  }, [clamped, excludeWelcome]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    let target: HTMLElement | null = null;
    const measure = () => {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const width = Math.min(390, window.innerWidth - 32);
      let left: number;
      let top: number;
      if (clamped === 0) {
        left = (window.innerWidth - width) / 2;
        top = (window.innerHeight - cardRect.height) / 2;
      } else if (targetSelector === '.editor-wrap') {
        left = window.innerWidth - width - 24;
        top = 18;
      } else if (targetSelector === '.generate-quiz-panel') {
        left = rect.right + 24;
        top = rect.top;
      } else if (rect.left + rect.width / 2 < window.innerWidth / 2) {
        left = rect.right + 28;
        top = Math.max(16, rect.top + (targetSelector.includes('file-tree') ? 54 : -8));
      } else {
        left = rect.left - width - 28;
        top = Math.max(16, rect.top - 8);
      }
      left = Math.max(16, Math.min(left, window.innerWidth - width - 16));
      top = Math.max(16, Math.min(top, window.innerHeight - cardRect.height - 16));
      setLayout({ left, top });
    };
    const syncTarget = () => {
      const found = document.querySelector<HTMLElement>(targetSelector);
      if (!found || found === target) return;
      target?.classList.remove('mv-tour-target-active');
      target = found;
      if (clamped > 0) target.classList.add('mv-tour-target-active');
      measure();
    };
    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer.disconnect();
      target?.classList.remove('mv-tour-target-active');
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [targetSelector, clamped]);

  return createPortal((
    <>
      <div
        ref={cardRef}
        className="mv-product-tour mv-onboarding-card"
        role="document"
        data-tour-target={targetSelector}
        style={{ left: layout.left, top: layout.top }}
      >
      <Flex align="center" justify="between" className="mv-tour-step-count">
        <Text size="1" color="gray" weight="medium">
          Getting started · {clamped + 1}/{PRODUCT_TOUR_STEPS.length}
        </Text>
      </Flex>

      <Heading size="5" className="mv-tour-step-title">
        {step.title}
      </Heading>
      {clamped === 2 ? (
        <ul className="mv-tour-instructions mv-tour-checklist">
          {body.map((item, index) => {
            const checked = writeExerciseChecks[index] ?? false;
            return (
              <li key={item} className={checked ? 'checked' : ''}>
                <span className="mv-tour-checkbox" role="checkbox" aria-checked={checked} aria-label={item}>
                  {checked ? <CheckIcon width={12} height={12} /> : null}
                </span>
                <span>{item}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="mv-tour-instructions">
          {body.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {clamped === 2 && !writeExerciseComplete ? (
        <Text as="p" size="1" color="gray" className="mv-tour-hint">
          Finish the heading, quote, and equation to continue.
        </Text>
      ) : null}
      <div className="mv-product-tour-dots" aria-hidden>
        {PRODUCT_TOUR_STEPS.map((_, index) => (
          <span
            key={index}
            className={index === clamped ? 'active' : index < clamped ? 'done' : ''}
          />
        ))}
      </div>

      <Flex align="center" justify="end" gap="3" className="mv-tour-actions">
        <IconButton
          type="button"
          variant="soft"
          color="gray"
          size="4"
          className="mv-tour-nav-button"
          aria-label="Back"
          title="Back"
          disabled={clamped === 0}
          onClick={() => onStepIndexChange(clamped - 1)}
        >
          <ChevronLeftIcon width={18} height={18} />
        </IconButton>
        {isLast ? (
          <IconButton
            type="button"
            variant="solid"
            size="4"
            className="mv-tour-nav-button"
            aria-label="Finish walkthrough"
            title="Finish walkthrough"
            onClick={onFinished}
          >
            <CheckIcon width={22} height={22} />
          </IconButton>
        ) : (
          <IconButton
            type="button"
            variant="solid"
            size="4"
            className="mv-tour-nav-button"
            aria-label="Next"
            title="Next"
            disabled={(clamped === 1 && !canAdvance) || (clamped === 2 && !writeExerciseComplete)}
            onClick={() => onStepIndexChange(clamped + 1)}
          >
            <ChevronRightIcon width={18} height={18} />
          </IconButton>
        )}
      </Flex>
      </div>
    </>
  ), document.querySelector('.radix-themes') ?? document.body);
}
