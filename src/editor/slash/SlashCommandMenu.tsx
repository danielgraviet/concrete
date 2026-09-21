import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  $getSelection,
  $createParagraphNode,
  $isRangeSelection,
  $isTextNode,
  FORMAT_TEXT_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  COMMAND_PRIORITY_HIGH,
  type LexicalEditor,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list';
import { usePublisher } from '@mdxeditor/gurx';
import {
  $createCodeBlockNode,
  insertImage$,
  insertMarkdown$,
  insertThematicBreak$,
  insertTable$,
} from '@mdxeditor/editor';
import { $insertNodeToNearestRoot } from '@lexical/utils';
import { handoffSlashToAi } from '../../ai/slashHandoff';
import {
  filterSlashCommands,
  isAmbiguousSlashPrefix,
  isFreeformSlashQuery,
  resolveExactSlashCommand,
  type SlashCommand,
  type SlashCommandId,
} from './slashCommands';

type SlashState = {
  query: string;
  /** Absolute screen coords for the menu. */
  left: number;
  top: number;
  /** Length of `/` + query to delete. */
  replaceLength: number;
};

function getSlashMatch(editor: LexicalEditor): SlashState | null {
  let result: SlashState | null = null;
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

    const anchor = selection.anchor;
    const node = anchor.getNode();
    if (!$isTextNode(node)) return;

    const textUpToCursor = node.getTextContent().slice(0, anchor.offset);
    // Allow spaces so `/how do I …` stays a slash query for AI handoff.
    const match = /(?:^|\s)(\/([^\n]*))$/.exec(textUpToCursor);
    if (!match) return;

    const replaceable = match[1];
    const query = match[2] ?? '';
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return;
    const rect = domSelection.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      // Fallback: use the text node's DOM rect
      const dom = editor.getElementByKey(node.getKey());
      if (!dom) return;
      const fallback = dom.getBoundingClientRect();
      result = {
        query,
        left: fallback.left,
        top: fallback.bottom + 6,
        replaceLength: replaceable.length,
      };
      return;
    }

    result = {
      query,
      left: rect.left,
      top: rect.bottom + 6,
      replaceLength: replaceable.length,
    };
  });
  return result;
}

function removeSlashTrigger(editor: LexicalEditor, replaceLength: number) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const anchor = selection.anchor;
    const node = anchor.getNode();
    if (!$isTextNode(node)) return;
    const start = Math.max(0, anchor.offset - replaceLength);
    node.select(start, anchor.offset);
    const next = $getSelection();
    if ($isRangeSelection(next)) next.removeText();
  });
}

/**
 * The block's CodeMirror mounts asynchronously, so `node.select()` right after
 * insertion is lost. Wait for its DOM and focus it directly.
 */
function focusCodeBlock(editor: LexicalEditor, key: string, framesLeft = 30) {
  requestAnimationFrame(() => {
    const target = editor.getElementByKey(key)?.querySelector<HTMLElement>('.cm-content');
    if (target) {
      target.focus();
      return;
    }
    if (framesLeft > 0) focusCodeBlock(editor, key, framesLeft - 1);
  });
}

function applySlashCommand(
  editor: LexicalEditor,
  id: SlashCommandId,
  helpers: {
    insertThematicBreak: () => void;
    insertMarkdown: (md: string) => void;
    insertImage: (params: { src: string; altText?: string }) => void;
    insertTable: (params: { rows?: number; columns?: number }) => void;
  },
) {
  switch (id) {
    case 'h1':
    case 'h2':
    case 'h3': {
      const tag = id;
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode(tag));
        }
      });
      break;
    }
    case 'bullet':
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
      break;
    case 'numbered':
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
      break;
    case 'check':
      editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
      break;
    case 'quote':
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createQuoteNode());
        }
      });
      break;
    case 'code':
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code');
      break;
    case 'codeBlock':
      editor.update(() => {
        const node = $createCodeBlockNode({ code: '', language: 'python' });
        const selection = $getSelection();
        const block = $isRangeSelection(selection)
          ? selection.anchor.getNode().getTopLevelElement()
          : null;
        if (block && block.getTextContent().trim() === '') {
          // The slash trigger left an empty paragraph — swap it for the block
          // instead of leaving a blank line above.
          block.replace(node);
        } else if (block) {
          block.insertAfter(node);
        } else {
          $insertNodeToNearestRoot(node);
        }
        if (!node.getNextSibling()) node.insertAfter($createParagraphNode());
        focusCodeBlock(editor, node.getKey());
      });
      break;
    case 'math':
      helpers.insertMarkdown('$formula$');
      break;
    case 'mathBlock':
      helpers.insertMarkdown('$$\nformula\n$$');
      break;
    case 'image': {
      const src = window.prompt('Image URL');
      if (!src) break;
      const altText = window.prompt('Alt text (optional)', '') ?? '';
      helpers.insertImage({ src, altText });
      break;
    }
    case 'table':
      // Three rows includes the Markdown header row, leaving two body rows.
      helpers.insertTable({ rows: 3, columns: 3 });
      break;
    case 'columns':
      helpers.insertMarkdown(':::columns\n:::column\n### Pros\n- \n:::\n:::column\n### Cons\n- \n:::\n:::');
      break;
    case 'divider':
      helpers.insertThematicBreak();
      break;
    default:
      break;
  }
}

/**
 * Slash menu that sits next to the caret and auto-applies exact aliases (`/h1`).
 */
export function SlashCommandMenu() {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<SlashState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const applyingRef = useRef(false);
  const lastQueryRef = useRef<string | null>(null);
  const insertThematicBreak = usePublisher(insertThematicBreak$);
  const insertMarkdown = usePublisher(insertMarkdown$);
  const insertImage = usePublisher(insertImage$);
  const insertTable = usePublisher(insertTable$);

  const options = menu ? filterSlashCommands(menu.query) : [];

  const runCommand = useCallback(
    (command: SlashCommand, replaceLength: number) => {
      if (applyingRef.current) return;
      applyingRef.current = true;
      setMenu(null);
      removeSlashTrigger(editor, replaceLength);
      queueMicrotask(() => {
        applySlashCommand(editor, command.id, {
          insertThematicBreak: () => insertThematicBreak(),
          insertMarkdown,
          insertImage,
          insertTable,
        });
        editor.focus();
        applyingRef.current = false;
      });
    },
    [editor, insertImage, insertMarkdown, insertTable, insertThematicBreak],
  );

  const runAiHandoff = useCallback(
    (query: string, replaceLength: number) => {
      if (applyingRef.current) return;
      const trimmed = query.trim();
      if (!trimmed) return;
      applyingRef.current = true;
      setMenu(null);
      removeSlashTrigger(editor, replaceLength);
      queueMicrotask(() => {
        handoffSlashToAi(trimmed);
        editor.focus();
        applyingRef.current = false;
      });
    },
    [editor],
  );

  // Track `/query` at the caret and auto-apply exact aliases.
  useEffect(() => {
    return editor.registerUpdateListener(() => {
      if (applyingRef.current) return;
      const match = getSlashMatch(editor);
      if (!match) {
        lastQueryRef.current = null;
        setMenu((current) => (current ? null : current));
        return;
      }

      // Exact single-token aliases auto-apply. Freeform (spaces / no hits) stays open for AI.
      if (
        match.query.length > 0 &&
        !/\s/.test(match.query) &&
        !isFreeformSlashQuery(match.query)
      ) {
        const exact = resolveExactSlashCommand(match.query);
        if (exact && !isAmbiguousSlashPrefix(match.query)) {
          runCommand(exact, match.replaceLength);
          return;
        }
      }

      setMenu(match);
      if (lastQueryRef.current !== match.query) {
        lastQueryRef.current = match.query;
        setSelectedIndex(0);
      }
    });
  }, [editor, runCommand]);

  // Keep menu pinned to caret while open (scroll / layout).
  useLayoutEffect(() => {
    if (!menu) return;
    const sync = () => {
      const match = getSlashMatch(editor);
      if (match) setMenu(match);
    };
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [editor, menu]);

  // Keyboard while menu is open.
  useEffect(() => {
    if (!menu) return;

    const freeform = isFreeformSlashQuery(menu.query);
    const showAskAi = freeform || (menu.query.trim().length > 0 && options.length === 0);

    const onDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        if (options.length === 0) return false;
        event?.preventDefault();
        setSelectedIndex((i) => (i + 1) % options.length);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const onUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        if (options.length === 0) return false;
        event?.preventDefault();
        setSelectedIndex((i) => (i - 1 + options.length) % options.length);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const onEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (showAskAi || freeform) {
          event?.preventDefault();
          runAiHandoff(menu.query, menu.replaceLength);
          return true;
        }
        // Honor the highlighted row; an exact alias only wins when nothing is highlighted.
        const command = options[selectedIndex] ?? resolveExactSlashCommand(menu.query);
        if (!command) return false;
        event?.preventDefault();
        runCommand(command, menu.replaceLength);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const onTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        if (showAskAi && options.length === 0) {
          event?.preventDefault();
          runAiHandoff(menu.query, menu.replaceLength);
          return true;
        }
        // Honor the highlighted row; an exact alias only wins when nothing is highlighted.
        const command = options[selectedIndex] ?? resolveExactSlashCommand(menu.query);
        if (!command) return false;
        event?.preventDefault();
        runCommand(command, menu.replaceLength);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const onEsc = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        event?.preventDefault();
        setMenu(null);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      onDown();
      onUp();
      onEnter();
      onTab();
      onEsc();
    };
  }, [editor, menu, options, runAiHandoff, runCommand, selectedIndex]);

  if (!menu) return null;

  const freeform = isFreeformSlashQuery(menu.query);
  const showAskAi = freeform || (menu.query.trim().length > 0 && options.length === 0);
  if (options.length === 0 && !showAskAi && menu.query.trim().length > 0) return null;
  // Bare `/` still shows the format list (options === all commands).

  const maxLeft = Math.max(8, window.innerWidth - 300);
  const left = Math.min(menu.left, maxLeft);
  const top =
    menu.top + 320 > window.innerHeight
      ? Math.max(8, menu.top - 328)
      : menu.top;

  return createPortal(
    <div
      className="slash-menu"
      role="listbox"
      aria-label="Formatting commands"
      style={{ position: 'fixed', left, top, zIndex: 1000 }}
    >
      {options.length > 0 ? (
        <>
          <div className="slash-heading">BASIC BLOCKS</div>
          {options.map((command, index) => (
            <button
              type="button"
              key={command.id}
              role="option"
              aria-selected={selectedIndex === index}
              className={selectedIndex === index ? 'selected' : undefined}
              onMouseEnter={() => setSelectedIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                runCommand(command, menu.replaceLength);
              }}
            >
              <span className="command-symbol">{command.symbol}</span>
              <span>{command.title}</span>
              <small>{command.aliases[0] ? `/${command.aliases[0]}` : command.hint}</small>
            </button>
          ))}
        </>
      ) : null}
      {showAskAi ? (
        <>
          <div className="slash-heading">TUTOR</div>
          <button
            type="button"
            role="option"
            aria-selected
            className="selected"
            onMouseDown={(event) => {
              event.preventDefault();
              runAiHandoff(menu.query, menu.replaceLength);
            }}
          >
            <span className="command-symbol">?</span>
            <span>Ask tutor</span>
            <small>Enter</small>
          </button>
        </>
      ) : null}
    </div>,
    document.querySelector('.radix-themes') ?? document.body,
  );
}
