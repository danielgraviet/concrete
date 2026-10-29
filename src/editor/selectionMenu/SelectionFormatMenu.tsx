import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setTextFormat,
  FORMAT_TEXT_COMMAND,
  KEY_ESCAPE_COMMAND,
  COMMAND_PRIORITY_LOW,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $patchStyleText, $setBlocksType } from '@lexical/selection';
import {
  FontBoldIcon,
  FontItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  CodeIcon,
} from '@radix-ui/react-icons';

type MenuPosition = { x: number; y: number; flip: boolean };

type MenuState = {
  position: MenuPosition;
  selectionKey: string;
};

type SelectionSnapshot = {
  rect: DOMRect;
  selectionKey: string;
  formats: Set<TextFormatType>;
};

const TOGGLE_FORMATS: TextFormatType[] = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'code',
  'highlight',
];

const CLEARABLE_FORMATS: Partial<Record<TextFormatType, boolean>> = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  code: false,
  highlight: false,
  subscript: false,
  superscript: false,
};

/** Delay before the menu appears once the selection settles — long enough to skip past drag noise. */
const SHOW_DELAY_MS = 350;
const MENU_GAP = 10;
/** Keeps the menu from running off either edge before it has measured its own width. */
const MENU_HALF_WIDTH_ESTIMATE = 150;

function selectionKeyFor(
  anchorKey: string,
  anchorOffset: number,
  focusKey: string,
  focusOffset: number,
): string {
  return `${anchorKey}:${anchorOffset}:${focusKey}:${focusOffset}`;
}

function readSelectionSnapshot(editor: LexicalEditor): SelectionSnapshot | null {
  if (!editor.isEditable()) return null;

  let result: SelectionSnapshot | null = null;
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || selection.isCollapsed()) return;

    const nodes = selection.getNodes();
    if (!nodes.some((node) => $isTextNode(node))) return;

    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) return;

    const root = editor.getRootElement();
    if (!root || !domSelection.anchorNode || !root.contains(domSelection.anchorNode)) return;

    const rect = domSelection.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const formats = new Set<TextFormatType>();
    for (const type of TOGGLE_FORMATS) {
      if (selection.hasFormat(type)) formats.add(type);
    }

    result = {
      rect,
      selectionKey: selectionKeyFor(
        selection.anchor.key,
        selection.anchor.offset,
        selection.focus.key,
        selection.focus.offset,
      ),
      formats,
    };
  });
  return result;
}

function computePosition(rect: DOMRect): MenuPosition {
  const estimatedMenuHeight = 44;
  const flip = rect.top - MENU_GAP - estimatedMenuHeight < 8;
  const x = Math.min(
    Math.max(rect.left + rect.width / 2, MENU_HALF_WIDTH_ESTIMATE + 8),
    window.innerWidth - MENU_HALF_WIDTH_ESTIMATE - 8,
  );
  const y = flip ? rect.bottom + MENU_GAP : rect.top - MENU_GAP;
  return { x, y, flip };
}

function applyNormalText(editor: LexicalEditor) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    $setTextFormat(selection, CLEARABLE_FORMATS);
    $patchStyleText(selection, { color: null, 'background-color': null });
    $setBlocksType(selection, () => $createParagraphNode());
  });
  editor.focus();
}

const FORMAT_BUTTONS: { type: TextFormatType; label: string; Icon: ComponentType }[] = [
  { type: 'bold', label: 'Bold', Icon: FontBoldIcon },
  { type: 'italic', label: 'Italic', Icon: FontItalicIcon },
  { type: 'underline', label: 'Underline', Icon: UnderlineIcon },
  { type: 'strikethrough', label: 'Strikethrough', Icon: StrikethroughIcon },
  { type: 'code', label: 'Inline code', Icon: CodeIcon },
];

/** `<mark>`-style highlight has no Radix icon; a small swatch matches Notion's glyph. */
function HighlightIcon() {
  return <span className="selection-menu-highlight-icon">A</span>;
}

/**
 * Notion-style floating formatting menu shown on text selection.
 * Appears after the selection settles (never mid-drag), stays anchored above
 * (or below, near the viewport top) the selection, and leaves it uncovered.
 */
export function SelectionFormatMenu() {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [formats, setFormats] = useState<Set<TextFormatType>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpenRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const pointerDownRef = useRef(false);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    menuOpenRef.current = menu !== null;
  }, [menu]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    lastKeyRef.current = null;
    setMenu((current) => (current ? null : current));
  }, [clearTimer]);

  // Re-checks the selection and either leaves the menu alone (same range —
  // only refreshes active-format highlighting), moves it (range changed
  // while already open), or schedules it to appear after a short pause.
  const evaluate = useCallback(() => {
    const snapshot = readSelectionSnapshot(editor);
    if (!snapshot) {
      hide();
      return;
    }

    setFormats(snapshot.formats);
    if (snapshot.selectionKey === lastKeyRef.current) return;
    lastKeyRef.current = snapshot.selectionKey;

    const position = computePosition(snapshot.rect);
    clearTimer();
    if (menuOpenRef.current) {
      setMenu({ position, selectionKey: snapshot.selectionKey });
    } else {
      timerRef.current = window.setTimeout(() => {
        setMenu({ position, selectionKey: snapshot.selectionKey });
      }, SHOW_DELAY_MS);
    }
  }, [editor, hide, clearTimer]);

  // Lexical funnels every native selection change (including the many fired
  // mid-drag) through its own update cycle, so this alone is a reliable feed.
  useEffect(() => {
    return editor.registerUpdateListener(() => {
      if (pointerDownRef.current) return;
      evaluate();
    });
  }, [editor, evaluate]);

  // Hide instantly on a new drag (no stale menu lingering) and never treat a
  // mousedown on the menu itself as "outside" — that would dismiss it mid-click.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      pointerDownRef.current = true;
      hide();
    };
    const onPointerUp = () => {
      pointerDownRef.current = false;
      requestAnimationFrame(() => evaluate());
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
    };
  }, [hide, evaluate]);

  useEffect(() => {
    if (!menu) return undefined;
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        hide();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, menu, hide]);

  const toggleFormat = useCallback(
    (type: TextFormatType) => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);
      editor.focus();
    },
    [editor],
  );

  const handleNormalText = useCallback(() => {
    applyNormalText(editor);
  }, [editor]);

  if (!menu) return null;

  const { x, y, flip } = menu.position;
  const transform = flip ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';

  return createPortal(
    <div
      ref={menuRef}
      className="selection-menu"
      role="toolbar"
      aria-label="Text formatting"
      style={{ position: 'fixed', left: x, top: y, transform }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {FORMAT_BUTTONS.map(({ type, label, Icon }) => (
        <button
          type="button"
          key={type}
          title={label}
          aria-label={label}
          aria-pressed={formats.has(type)}
          className={formats.has(type) ? 'active' : undefined}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleFormat(type);
          }}
        >
          <Icon />
        </button>
      ))}
      <button
        type="button"
        title="Highlight"
        aria-label="Highlight"
        aria-pressed={formats.has('highlight')}
        className={formats.has('highlight') ? 'active' : undefined}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleFormat('highlight');
        }}
      >
        <HighlightIcon />
      </button>
      <div className="selection-menu-divider" />
      <button
        type="button"
        className="selection-menu-normal"
        title="Convert to a plain paragraph and clear formatting"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleNormalText();
        }}
      >
        Normal Text
      </button>
    </div>,
    document.querySelector('.radix-themes') ?? document.body,
  );
}
