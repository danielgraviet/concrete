import { Cross1Icon, ClipboardIcon, FileTextIcon, LayersIcon } from '@radix-ui/react-icons';
import { isPdfFileName } from './fileTree';
import { PdfFileIcon } from './PdfFileIcon';
import { isQuizPath } from '../quiz';

const MAX_TAB_TITLE_CHARS = 32;

function tabTitleFor(path: string): string {
  const title = (path.split('/').pop() ?? path).replace(/\.(?:md|pdf)$/i, '') || 'Untitled';
  return title.length > MAX_TAB_TITLE_CHARS
    ? `${title.slice(0, MAX_TAB_TITLE_CHARS - 1)}…`
    : title;
}

type Props = {
  tabs: string[];
  selected: string;
  previewTab?: string | null;
  dirtyPath: string | null;
  reviewLabel: string | null;
  reviewing: boolean;
  onSelect: (path: string) => void;
  onPin: (path: string) => void;
  onClose: (path: string) => void;
  onResumeReview: () => void;
  onEndReview: () => void;
};

/** Horizontal open-note tabs (max five) plus an optional review tab. */
export function OpenTabsBar({
  tabs,
  selected,
  previewTab = null,
  dirtyPath,
  reviewLabel,
  reviewing,
  onSelect,
  onPin,
  onClose,
  onResumeReview,
  onEndReview,
}: Props) {
  return (
    <>
      {reviewLabel ? (
        <button
          type="button"
          className={`tab tab-review ${reviewing ? 'active' : ''}`}
          title={reviewing ? 'Reviewing' : 'Resume review'}
          onClick={onResumeReview}
        >
          <LayersIcon width={14} height={14} />
          <span className="tab-title">Review · {reviewLabel}</span>
          <span
            role="button"
            tabIndex={-1}
            className="tab-close"
            aria-label="End review"
            onClick={(event) => {
              event.stopPropagation();
              onEndReview();
            }}
          >
            <Cross1Icon width={10} height={10} />
          </span>
        </button>
      ) : null}

      {tabs.map((path) => {
        const active = !reviewing && path === selected;
        const dirty = dirtyPath === path;
        return (
          <button
            key={path}
            type="button"
            className={`tab ${active ? 'active' : ''} ${previewTab === path ? 'preview' : ''}`}
            title={path}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(path)}
            onDoubleClick={() => onPin(path)}
          >
            {isQuizPath(path) ? (
              <ClipboardIcon width={14} height={14} />
            ) : isPdfFileName(path) ? (
              <PdfFileIcon />
            ) : (
              <FileTextIcon width={14} height={14} />
            )}
            <span className="tab-title">{tabTitleFor(path)}</span>
            {dirty ? <span className="dirty">•</span> : null}
            {tabs.length > 1 ? (
              <span
                role="button"
                tabIndex={-1}
                className="tab-close"
                aria-label={`Close ${tabTitleFor(path)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(path);
                }}
              >
                <Cross1Icon width={10} height={10} />
              </span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}
