/**
 * Local command types so this layer stays compilable without src/core.
 * When core lands, App can map core commands onto these callbacks.
 */
export type EditorCommandName =
  | 'undo'
  | 'redo'
  | 'save'
  | 'bold'
  | 'italic'
  | 'heading'
  | 'link'
  | 'code'
  | string;

export type EditorCommand = {
  name: EditorCommandName;
  payload?: unknown;
};

export type EditorCommandHandler = (command: EditorCommand) => boolean | void;
