import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hashSeed } from './shuffle';

const QUOTES: ReadonlyArray<{ text: string; author: string }> = [
  { text: 'It is my experience that proofs involving matrices can be shortened by 50% if one throws the matrices out.', author: 'Emil Artin' },
  { text: "In mathematics you don't understand things. You just get used to them.", author: 'John von Neumann' },
  { text: 'Problems worthy of attack prove their worth by hitting back.', author: 'Piet Hein' },
  { text: 'Mathematics is the work of the human mind, which is destined rather to study than to know, to seek the truth rather than to find it.', author: 'Évariste Galois' },
  { text: 'If I have seen further it is by standing on the shoulders of Giants.', author: 'Isaac Newton' },
  { text: "Above all, don't fear difficult moments. The best comes from them.", author: 'Rita Levi-Montalcini' },
  { text: 'Research is to see what everybody else has seen, and to think what nobody else has thought.', author: 'Albert Szent-Györgyi' },
  { text: 'We are just an advanced breed of monkeys on a minor planet of a very average star. But we can understand the Universe. That makes us something very special.', author: 'Stephen Hawking' },
  { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
];

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

type Props = {
  /** How many quizzes the student has now taken, this one included. */
  quizNumber: number;
  /** Picks the quote, so it stays the same for one attempt. */
  seed: string;
};

/** Attempts already celebrated, so leaving and reopening a quiz doesn't pop it again. */
const celebrated = new Set<string>();

/** A small "you did a hard thing" moment right after submitting, over the dimmed quiz. */
export function QuizCelebration({ quizNumber, seed }: Props) {
  const [open, setOpen] = useState(() => !celebrated.has(seed));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const quote = QUOTES[hashSeed(seed) % QUOTES.length];

  const close = () => {
    celebrated.add(seed);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    buttonRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus and bind keys once per opening
  }, [open, seed]);

  if (!open) return null;

  return createPortal(
    <div
      className="quiz-celebration-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="quiz-celebration" role="dialog" aria-modal="true" aria-labelledby="quiz-celebration-title">
        <div className="quiz-celebration-mark" aria-hidden>🎉</div>
        <h2 id="quiz-celebration-title">
          {quizNumber === 1 ? 'You just took your first quiz!' : `You just took your ${ordinal(quizNumber)} quiz!`}
        </h2>
        <p className="quiz-muted">Pushing yourself on hard questions is how it sticks. Nice work.</p>
        <blockquote className="quiz-celebration-quote">
          “{quote.text}”
          <cite>— {quote.author}</cite>
        </blockquote>
        <button ref={buttonRef} type="button" className="quiz-btn primary" onClick={close}>
          Keep going
        </button>
      </section>
    </div>,
    document.body,
  );
}
