import { useEffect, useRef, useState } from 'react';
import { ArrowRightIcon, ClipboardIcon, FileTextIcon, MagnifyingGlassIcon, PlusIcon } from '@radix-ui/react-icons';
import { Button, Flex } from '@radix-ui/themes';
import type { DailyActivityStore } from '../quiz/dailyActivity';
import type { QuizHistoryStore } from '../quiz/history';
import { isQuizPath } from '../quiz/paths';
import { summarizeActivity } from '../quiz/progressStats';
import { noteTitle, parentDir } from './fileTree';

type Props = {
  recentPaths: string[];
  availablePaths: ReadonlySet<string>;
  historyStore: QuizHistoryStore;
  activityStore: DailyActivityStore;
  onOpen: (path: string) => void;
  onCreate: () => void;
  onSearch: () => void;
};

const RECENT_LIMIT = 5;

export function VaultHome({ recentPaths, availablePaths, historyStore, activityStore, onOpen, onCreate, onSearch }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [, refresh] = useState(0);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    const onChange = () => refresh((revision) => revision + 1);
    const unsubscribeHistory = historyStore.subscribe(onChange);
    const unsubscribeActivity = activityStore.subscribe(onChange);
    return () => {
      unsubscribeHistory();
      unsubscribeActivity();
    };
  }, [historyStore, activityStore]);

  const attempts = historyStore.getAll();
  const { streak } = summarizeActivity(attempts, activityStore.getDays());
  const recentFiles = recentPaths.filter((path) => availablePaths.has(path) && !isQuizPath(path)).slice(0, RECENT_LIMIT);
  const recentQuizzes = [...new Set([
    ...recentPaths.filter(isQuizPath),
    ...attempts.map((attempt) => attempt.quizPath),
  ])].filter((path) => availablePaths.has(path)).slice(0, RECENT_LIMIT);

  return (
    <section className="vault-home" aria-labelledby="vault-home-title">
      <header className="vault-home-header">
        <div>
          <h1 id="vault-home-title" ref={heading} tabIndex={-1}>Welcome back</h1>
          <p>Pick up where you left off.</p>
        </div>
        <Flex gap="2" wrap="wrap">
          <Button variant="soft" color="gray" highContrast onClick={onSearch}>
            <MagnifyingGlassIcon /> Find a file
          </Button>
          <Button highContrast onClick={onCreate}>
            <PlusIcon /> New note
          </Button>
        </Flex>
      </header>

      <dl className="vault-home-stats">
        <div><dt>Day streak</dt><dd>{streak}</dd></div>
        <div><dt>Quiz attempts</dt><dd>{attempts.length}</dd></div>
      </dl>

      <div className="vault-home-recents">
        <RecentList id="home-recent-files" title="Recent files" paths={recentFiles} empty="Files you open will show up here." onOpen={onOpen} />
        <RecentList id="home-recent-quizzes" title="Recent quizzes" paths={recentQuizzes} empty="Open or take a quiz to see it here." onOpen={onOpen} quiz />
      </div>
    </section>
  );
}

function RecentList({ id, title, paths, empty, onOpen, quiz = false }: {
  id: string;
  title: string;
  paths: string[];
  empty: string;
  onOpen: (path: string) => void;
  quiz?: boolean;
}) {
  const Icon = quiz ? ClipboardIcon : FileTextIcon;
  return (
    <section aria-labelledby={id} className="vault-home-list">
      <h2 id={id}>{title}</h2>
      {paths.length ? (
        <ul>
          {paths.map((path) => (
            <li key={path}>
              <button type="button" onClick={() => onOpen(path)} title={path}>
                <Icon aria-hidden="true" />
                <span>
                  <strong>{noteTitle(path)}</strong>
                  {parentDir(path) ? <small>{parentDir(path)}</small> : null}
                </span>
                <ArrowRightIcon aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : <p>{empty}</p>}
    </section>
  );
}
