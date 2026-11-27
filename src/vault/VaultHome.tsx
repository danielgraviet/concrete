import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRightIcon, ClipboardIcon, FileTextIcon, MagnifyingGlassIcon, PlusIcon } from '@radix-ui/react-icons';
import { Button, Flex } from '@radix-ui/themes';
import type { DailyActivityStore } from '../quiz/dailyActivity';
import type { QuizHistoryStore } from '../quiz/history';
import { isQuizPath } from '../quiz/paths';
import { summarizeActivity } from '../quiz/progressStats';
import { noteTitle, parentDir } from './fileTree';
import { flameProgress, QUIZ_RANKS, rankProgress, type QuizRank } from './homeMilestones';
import { RankBadge } from './RankBadge';
import { StreakFlame } from './StreakFlame';

type Props = {
  recentPaths: string[];
  availablePaths: ReadonlySet<string>;
  historyStore: QuizHistoryStore;
  activityStore: DailyActivityStore;
  vaultRoot: string;
  onOpen: (path: string) => void;
  onCreate: () => void;
  /** Opens quiz creation. Omit to hide the button (e.g. the mobile shell, where quizzes are take-only). */
  onNewQuiz?: () => void;
  onSearch: () => void;
};

const RECENT_LIMIT = 5;
const RANK_UP_MS = 2600;

export function VaultHome({ recentPaths, availablePaths, historyStore, activityStore, vaultRoot, onOpen, onCreate, onNewQuiz, onSearch }: Props) {
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
  const flame = flameProgress(streak);
  const rank = rankProgress(attempts.length);
  const [rankUpFrom, setRankUpFrom] = useState<number | null>(null);

  // The rank reveal plays every time the home screen opens: the tier below
  // cracks apart to show the metal you hold now (nothing to crack from sand).
  useEffect(() => {
    setRankUpFrom(rank.index > 0 ? rank.index - 1 : null);
  }, [rank.index]);

  useEffect(() => {
    if (rankUpFrom === null) return;
    const timer = window.setTimeout(() => setRankUpFrom(null), RANK_UP_MS);
    return () => window.clearTimeout(timer);
  }, [rankUpFrom]);

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
          <Button variant="soft" color="gray" highContrast onClick={onCreate}>
            <PlusIcon /> New note
          </Button>
          {onNewQuiz ? (
            <Button highContrast onClick={onNewQuiz}>
              <ClipboardIcon /> New quiz
            </Button>
          ) : null}
        </Flex>
      </header>

      <dl className="vault-home-stats">
        <div
          className={`vault-home-stat vault-home-stat-flame${flame.current.key === 'ember' ? ' is-cold' : ''}`}
          style={{ '--chip': flame.current.chip, '--card-glow': flame.current.glow.replace(/[\d.]+\)$/, '.14)') } as CSSProperties}
        >
          <div className="vault-home-stat-art"><StreakFlame stage={flame.current} /></div>
          <div className="vault-home-stat-text">
            <dt>Day streak</dt>
            <dd>
              <span className="vault-home-stat-value">{streak}</span>
              <span className="vault-home-tier"><span className="vault-home-tier-chip" />{flame.current.name}</span>
              <span className="vault-home-next">
                {flame.next ? `${flame.remaining} more ${flame.remaining === 1 ? 'day' : 'days'} to ${flame.next.name}` : 'Highest stage. Keep it burning.'}
              </span>
            </dd>
          </div>
        </div>
        <div
          className={`vault-home-stat vault-home-stat-rank${rank.current.key === 'sand' ? ' is-cold' : ''}`}
          style={{ '--chip': rank.current.color, '--card-glow': `${rank.current.color}22` } as CSSProperties}
        >
          <div className="vault-home-stat-art">
            {rankUpFrom !== null ? (
              <RankUp from={QUIZ_RANKS[rankUpFrom]} to={rank.current} />
            ) : (
              <RankBadge rank={rank.current} progress={rank.progress} />
            )}
          </div>
          <div className="vault-home-stat-text">
            <dt>Quiz attempts</dt>
            <dd>
              <span className="vault-home-stat-value">{attempts.length}</span>
              <span className="vault-home-tier"><span className="vault-home-tier-chip" />{rank.current.name}</span>
              <span className="vault-home-next">
                {rank.next ? `${attempts.length} / ${rank.next.min} to ${rank.next.name}` : 'Top rank reached'}
              </span>
              <span className="vault-home-shelf" aria-label={`Ranks unlocked: ${rank.index} of ${QUIZ_RANKS.length - 1}`} role="img">
                {QUIZ_RANKS.slice(1).map((tier, i) => (
                  <span
                    key={tier.key}
                    className={`vault-home-shelf-slot${i + 1 > rank.index ? ' is-locked' : ''}${i + 1 === rank.index ? ' is-current' : ''}`}
                    title={`${tier.name}: ${tier.min} ${tier.min === 1 ? 'quiz' : 'quizzes'}`}
                  >
                    <RankBadge rank={tier} size={26} />
                  </span>
                ))}
              </span>
            </dd>
          </div>
          {rankUpFrom !== null ? <p className="sr-only" role="status">Current rank: {rank.current.name}</p> : null}
        </div>
      </dl>

      <div className="vault-home-recents">
        <RecentList id="home-recent-files" title="Recent files" paths={recentFiles} empty="Files you open will show up here." onOpen={onOpen} />
        <RecentList id="home-recent-quizzes" title="Recent quizzes" paths={recentQuizzes} empty="Open or take a quiz to see it here." onOpen={onOpen} quiz />
      </div>
    </section>
  );
}

const SHARDS = Array.from({ length: 9 }, (_, i) => {
  const angle = (i / 9) * Math.PI * 2 + 0.3;
  return { x: Math.round(Math.cos(angle) * 70), y: Math.round(Math.sin(angle) * 70), r: (i * 97) % 360 };
});

/** One-time animation: the previous rank's badge cracks open to reveal the new one. */
function RankUp({ from, to }: { from: QuizRank; to: QuizRank }) {
  return (
    <div className="rank-up" aria-hidden="true">
      <div className="rank-up-burst" style={{ '--burst': to.color } as CSSProperties} />
      <div className="rank-up-new"><RankBadge rank={to} /></div>
      <div className="rank-up-half rank-up-left"><RankBadge rank={from} /></div>
      <div className="rank-up-half rank-up-right"><RankBadge rank={from} /></div>
      <svg className="rank-up-crack" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline pathLength={1} points="50,12 45,30 55,45 46,62 54,78 50,88" />
      </svg>
      {SHARDS.map((shard, i) => (
        <span
          key={i}
          className="rank-up-shard"
          style={{ '--shard': from.color, '--sx': `${shard.x}px`, '--sy': `${shard.y}px`, '--sr': `${shard.r}deg` } as CSSProperties}
        />
      ))}
    </div>
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
