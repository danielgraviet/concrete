import { useEffect, useState } from 'react';
import type { AiClient } from '../ai/AiClient';
import { QuizEditView } from './QuizEditView';
import { QuizTakeView } from './QuizTakeView';
import type { QuizHistoryStore } from './history';

type Mode = 'take' | 'edit';

type Props = {
  documentPath: string;
  markdown: string;
  client: AiClient;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  historyStore?: QuizHistoryStore;
};

export function QuizShell({ documentPath, markdown, client, onChange, onBlur, historyStore }: Props) {
  const [mode, setMode] = useState<Mode>('take');
  const [boundPath, setBoundPath] = useState(documentPath);

  useEffect(() => {
    if (boundPath !== documentPath) {
      setBoundPath(documentPath);
      setMode('take');
    }
  }, [boundPath, documentPath]);

  if (mode === 'edit') {
    return (
      <QuizEditView
        markdown={markdown}
        onChange={onChange}
        onBlur={onBlur}
        onTake={() => setMode('take')}
      />
    );
  }

  return (
    <QuizTakeView
      markdown={markdown}
      documentPath={documentPath}
      client={client}
      onEdit={() => setMode('edit')}
      historyStore={historyStore}
    />
  );
}
