import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Callout, Flex, Spinner, Text } from '@radix-ui/themes';
import { CopyIcon } from '@radix-ui/react-icons';
import type { ShareRecord } from '../../backend/cloud/CloudRepository';
import type { CloudUser } from '../../backend/cloud/AuthProvider';
import type { WebSession } from '../../backend/web/session';
import { BrandLogo } from '../../branding/BrandLogo';
import { parseClozeBlanks } from '../../learn/parseNoteCards';
import { QuizMarkdown } from '../../quiz/QuizMarkdown';
import type { QuizQuestion } from '../../quiz/types';
import { settingsStore } from '../../settings';
import { duplicateShare } from './duplicate';
import { linkedCardWriter } from './linkedCards';
import { readSharePayload, titleFromPath } from './payloads';
import { ShareMarkdown } from './ShareMarkdown';
import { shareErrorMessage } from './ShareDialog';
import type { DeckPayload, FolderPayload, NotePayload, QuizPayload, SharedCard, SharedNote } from './types';
import '../web.css';
import './share.css';

/** Same key App.tsx restores the open note from. */
const LAST_NOTE_KEY = 'mv:last-note';

const KIND_LABEL: Record<ShareRecord['kind'], string> = { note: 'Note', folder: 'Folder', deck: 'Flashcards', quiz: 'Quiz' };

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; record: ShareRecord };

type DupState = { status: 'idle' } | { status: 'working' } | { status: 'error'; message: string };

function useAuthUser(session: WebSession): { user: CloudUser | null; known: boolean } {
  const [state, setState] = useState(() => {
    const user = session.auth.currentUser();
    return { user, known: Boolean(user) };
  });
  useEffect(() => session.auth.onChange((user) => setState({ user, known: true })), [session]);
  return state;
}

/** Public, read-only page for `/s/:shareId`. Works signed out. */
export function ShareViewer({ shareId, session }: { shareId: string; session: WebSession }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [dup, setDup] = useState<DupState>({ status: 'idle' });
  const { user } = useAuthUser(session);

  useEffect(() => {
    let cancelled = false;
    session.repo
      .getShare(shareId)
      .then((record) => {
        if (!cancelled) setLoad(record ? { status: 'ready', record } : { status: 'missing' });
      })
      .catch((error) => {
        if (!cancelled) setLoad({ status: 'error', message: shareErrorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [session, shareId]);

  useEffect(() => {
    document.title =
      load.status === 'ready'
        ? `${load.record.title} · Concrete`
        : load.status === 'missing'
          ? 'Link not found · Concrete'
          : 'Concrete';
  }, [load]);

  const duplicate = async () => {
    if (load.status !== 'ready') return;
    setDup({ status: 'working' });
    try {
      const signedIn = user ?? (await session.auth.signInWithGoogle());
      const result = await duplicateShare(load.record, {
        repo: session.repo,
        ws: signedIn.uid,
        addLinkedCards: linkedCardWriter(session, signedIn),
      });
      try {
        if (result.openPath) localStorage.setItem(LAST_NOTE_KEY, result.openPath);
      } catch {
        // Storage unavailable: the app opens its default note.
      }
      window.location.assign('/');
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      setDup({
        status: 'error',
        message: /popup-closed|cancelled-popup/.test(code) ? 'Sign-in was cancelled.' : shareErrorMessage(error),
      });
    }
  };

  return (
    <div className="share-page">
      <header className="share-header">
        <a href="/" className="share-brand" aria-label="Concrete home">
          <BrandLogo logo={settingsStore.get().brandLogo} className="share-logo" />
        </a>
        <div className="share-header-spacer" />
        {load.status === 'ready' ? (
          <Button onClick={() => void duplicate()} loading={dup.status === 'working'}>
            <CopyIcon />
            {user ? 'Duplicate to my workspace' : 'Sign in to duplicate'}
          </Button>
        ) : null}
      </header>
      <main className="share-main">
        {load.status === 'loading' ? (
          <Flex justify="center" py="9">
            <Spinner size="3" />
          </Flex>
        ) : load.status === 'missing' ? (
          <div className="share-empty">
            <Text as="p" size="5" weight="bold">
              This link doesn&apos;t work
            </Text>
            <Text as="p" size="2" color="gray">
              The share may have been deleted by its owner, or the link is incomplete.
            </Text>
            <Button asChild variant="soft">
              <a href="/">Go to Concrete</a>
            </Button>
          </div>
        ) : load.status === 'error' ? (
          <Callout.Root color="red" role="alert">
            <Callout.Text>Could not load this share: {load.message}</Callout.Text>
          </Callout.Root>
        ) : (
          <>
            {dup.status === 'error' ? (
              <Callout.Root color="red" size="1" role="alert" mb="4">
                <Callout.Text>{dup.message}</Callout.Text>
              </Callout.Root>
            ) : null}
            <ShareContent record={load.record} />
          </>
        )}
      </main>
    </div>
  );
}

function ShareContent({ record }: { record: ShareRecord }) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, payload: readSharePayload(record.kind, record.payload) };
    } catch (error) {
      return { ok: false as const, message: shareErrorMessage(error) };
    }
  }, [record]);

  const created = new Date(record.createdAt);
  return (
    <article>
      <div className="share-title-row">
        <Badge color="gray" variant="soft">
          {KIND_LABEL[record.kind]}
        </Badge>
        <Text size="1" color="gray">
          Snapshot from {Number.isNaN(created.getTime()) ? 'an earlier date' : created.toLocaleDateString()}
        </Text>
      </div>
      <h1 className="share-title">{record.title}</h1>
      {!parsed.ok ? (
        <Callout.Root color="amber">
          <Callout.Text>{parsed.message}</Callout.Text>
        </Callout.Root>
      ) : record.kind === 'note' ? (
        <ShareMarkdown markdown={(parsed.payload as NotePayload).markdown} />
      ) : record.kind === 'folder' ? (
        <NotesBrowser notes={(parsed.payload as FolderPayload).notes} />
      ) : record.kind === 'deck' ? (
        <DeckView payload={parsed.payload as DeckPayload} />
      ) : (
        <QuizView payload={parsed.payload as QuizPayload} />
      )}
    </article>
  );
}

function NotesBrowser({ notes }: { notes: SharedNote[] }) {
  const [selected, setSelected] = useState(notes[0]?.path ?? '');
  if (!notes.length) return <Text color="gray">This folder has no notes.</Text>;
  const current = notes.find((note) => note.path === selected) ?? notes[0];
  return (
    <div className="share-folder">
      <nav className="share-folder-list" aria-label="Notes">
        {notes.map((note) => (
          <button
            key={note.path}
            type="button"
            className={note.path === current.path ? 'selected' : ''}
            onClick={() => setSelected(note.path)}
            title={note.path}
          >
            {note.path.replace(/\.md$/i, '')}
          </button>
        ))}
      </nav>
      <div className="share-folder-note">
        <h2 className="share-subtitle">{titleFromPath(current.path)}</h2>
        <ShareMarkdown key={current.path} markdown={current.markdown} />
      </div>
    </div>
  );
}

function clozeFace(text: string, revealed: boolean): string {
  let out = '';
  let last = 0;
  for (const blank of parseClozeBlanks(text)) {
    out += text.slice(last, blank.start);
    out += revealed ? `**${blank.answer}**` : `[${blank.hint ?? '…'}]`;
    last = blank.end;
  }
  return out + text.slice(last);
}

function FlipCard({ card }: { card: SharedCard }) {
  const [flipped, setFlipped] = useState(false);
  let front: string;
  let back: string;
  if (card.kind === 'basic') {
    front = card.front;
    back = card.back;
  } else if (card.kind === 'cloze') {
    front = clozeFace(card.text, false);
    back = clozeFace(card.text, true);
  } else {
    front = `${card.prompt}\n\n${card.options.map((o) => `- ${o.text}`).join('\n')}`;
    back = card.options
      .filter((o) => o.correct)
      .map((o) => `- ${o.text}`)
      .join('\n');
  }
  return (
    <div
      role="button"
      tabIndex={0}
      className={`share-card${flipped ? ' flipped' : ''}`}
      onClick={() => setFlipped((f) => !f)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setFlipped((f) => !f);
        }
      }}
      aria-pressed={flipped}
      title={flipped ? 'Show front' : 'Show answer'}
    >
      <span className="share-card-side">{flipped ? 'Answer' : card.kind === 'mcq' ? 'Question' : 'Front'}</span>
      <ShareMarkdown className="share-card-body" markdown={flipped ? back : front} />
      {card.kind === 'basic' && card.reverse ? <span className="share-card-hint">Two-way</span> : null}
    </div>
  );
}

function DeckView({ payload }: { payload: DeckPayload }) {
  return (
    <>
      <Text as="p" size="2" color="gray" mb="3">
        {payload.cards.length} card{payload.cards.length === 1 ? '' : 's'} · click a card to flip it
      </Text>
      <div className="share-cards">
        {payload.cards.map((card, index) => (
          <FlipCard key={index} card={card} />
        ))}
      </div>
      {payload.notes.length ? (
        <section className="share-section">
          <h2 className="share-subtitle">Source notes</h2>
          <NotesBrowser notes={payload.notes} />
        </section>
      ) : null}
    </>
  );
}

function QuestionAnswer({ question }: { question: QuizQuestion }) {
  if (question.type === 'mcq') return null;
  if (question.type === 'cloze') {
    return (
      <>
        <Text as="p" size="2">
          <strong>Answers:</strong> {question.answers.join(', ')}
        </Text>
        {question.explanation ? <QuizMarkdown>{question.explanation}</QuizMarkdown> : null}
      </>
    );
  }
  const answer = question.type === 'open' ? question.answer : question.expected;
  const why = question.type === 'code' ? question.explanation : undefined;
  return (
    <>
      <QuizMarkdown>{question.type === 'code' && question.kind === 'predict-output' ? `\`\`\`text\n${answer}\n\`\`\`` : answer}</QuizMarkdown>
      {question.keyPoints?.length ? (
        <ul className="share-keypoints">
          {question.keyPoints.map((point, i) => (
            <li key={i}>
              <QuizMarkdown inline>{point}</QuizMarkdown>
            </li>
          ))}
        </ul>
      ) : null}
      {why ? <QuizMarkdown>{why}</QuizMarkdown> : null}
    </>
  );
}

function QuizQuestionView({ question, index }: { question: QuizQuestion; index: number }) {
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const prompt = question.type === 'cloze' ? question.prompt.replace(/\{\{[^}]*\}\}/g, '_____') : question.prompt;
  return (
    <section className="share-question">
      <Text as="div" size="1" color="gray" mb="1">
        Question {index + 1}
      </Text>
      <QuizMarkdown>{prompt}</QuizMarkdown>
      {question.type === 'code' && question.snippet ? (
        <QuizMarkdown>{`\`\`\`${question.language}\n${question.snippet}\n\`\`\``}</QuizMarkdown>
      ) : null}
      {question.type === 'mcq' ? (
        <div className="share-options">
          {question.options.map((option) => {
            const state = picked ? (option.correct ? 'correct' : option.id === picked ? 'wrong' : '') : '';
            return (
              <button
                key={option.id}
                type="button"
                className={`share-option ${state}`}
                onClick={() => setPicked(option.id)}
                disabled={Boolean(picked)}
              >
                <QuizMarkdown inline>{option.text}</QuizMarkdown>
              </button>
            );
          })}
        </div>
      ) : revealed ? (
        <div className="share-answer">
          <QuestionAnswer question={question} />
        </div>
      ) : (
        <Button size="1" variant="soft" onClick={() => setRevealed(true)}>
          Reveal answer
        </Button>
      )}
    </section>
  );
}

function QuizView({ payload }: { payload: QuizPayload }) {
  const questions = payload.quiz.questions;
  return (
    <>
      <Text as="p" size="2" color="gray" mb="3">
        {questions.length} question{questions.length === 1 ? '' : 's'}. Duplicate it to take it with grading and track your progress.
      </Text>
      {questions.map((question, index) => (
        <QuizQuestionView key={question.id ?? index} question={question} index={index} />
      ))}
    </>
  );
}
