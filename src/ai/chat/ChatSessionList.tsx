import { useState } from 'react';
import { MagnifyingGlassIcon, TrashIcon } from '@radix-ui/react-icons';
import { noteTitle } from '../../vault/fileTree';
import { filterSessions, formatSessionAge } from './sessionList';
import type { ChatSessionMeta } from './sessionStore';

type Props = {
  sessions: ChatSessionMeta[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
};

function notesLabel(notePaths: string[]): string {
  if (notePaths.length === 0) return 'No note';
  const first = noteTitle(notePaths[0]);
  return notePaths.length === 1 ? first : `${first} +${notePaths.length - 1}`;
}

/** Past Study Chat sessions, newest first, filterable by title or note. */
export function ChatSessionList({ sessions, activeId, onOpen, onDelete }: Props) {
  const [query, setQuery] = useState('');
  const shown = filterSessions(sessions, query);

  return (
    <div className="study-chat-history">
      <label className="study-chat-history-filter">
        <MagnifyingGlassIcon />
        <input
          autoFocus
          value={query}
          placeholder="Filter chats"
          aria-label="Filter chats"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && shown[0]) onOpen(shown[0].id);
          }}
        />
      </label>
      {shown.length === 0 ? (
        <p className="study-chat-history-empty">
          {sessions.length === 0 ? 'No past chats yet.' : 'No chats match.'}
        </p>
      ) : (
        <ul aria-label="Chat history">
          {shown.map((session) => (
            <li key={session.id} className={session.id === activeId ? 'active' : undefined}>
              <button
                type="button"
                className="study-chat-history-open"
                aria-current={session.id === activeId ? 'true' : undefined}
                onClick={() => onOpen(session.id)}
              >
                <span className="study-chat-history-title">{session.title}</span>
                <span className="study-chat-history-meta" title={session.notePaths.join('\n')}>
                  {notesLabel(session.notePaths)} · {formatSessionAge(session.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                className="study-chat-icon"
                title="Delete chat"
                aria-label={`Delete chat “${session.title}”`}
                onClick={() => {
                  if (window.confirm(`Delete “${session.title}”? This can’t be undone.`)) onDelete(session.id);
                }}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
