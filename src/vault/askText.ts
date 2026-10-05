/**
 * In-DOM text prompt. Electron disables `window.prompt()` (throws),
 * so create/rename flows must use this instead.
 */
export type AskTextOptions = {
  /** Small left-aligned action (e.g. "Import PDF…"). Closes the prompt (resolving null), then runs. */
  extraAction?: { label: string; onClick: () => void };
};

export function askText(
  message: string,
  defaultValue = '',
  options: AskTextOptions = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'mv-overlay mv-prompt-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const panel = document.createElement('div');
    panel.className = 'mv-prompt-panel';

    const label = document.createElement('label');
    label.className = 'mv-prompt-label';
    label.textContent = message;

    const input = document.createElement('input');
    input.className = 'mv-prompt-input';
    input.type = 'text';
    input.value = defaultValue;
    input.autocomplete = 'off';
    input.spellcheck = false;

    const actions = document.createElement('div');
    actions.className = 'mv-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'mv-btn mv-btn-ghost';
    cancelBtn.textContent = 'Cancel';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'mv-btn';
    okBtn.textContent = 'Create';

    const finish = (value: string | null) => {
      overlay.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    };

    const submit = () => {
      const trimmed = input.value.trim();
      finish(trimmed ? trimmed : null);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    };

    cancelBtn.addEventListener('click', () => finish(null));
    okBtn.addEventListener('click', submit);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(null);
    });
    overlay.addEventListener('keydown', onKey);

    if (options.extraAction) {
      const { label: extraLabel, onClick } = options.extraAction;
      const extraBtn = document.createElement('button');
      extraBtn.type = 'button';
      extraBtn.className = 'mv-btn mv-btn-ghost mv-prompt-extra';
      extraBtn.textContent = extraLabel;
      extraBtn.addEventListener('click', () => {
        finish(null);
        onClick();
      });
      actions.append(extraBtn);
    }
    actions.append(cancelBtn, okBtn);
    panel.append(label, input, actions);
    overlay.append(panel);
    // Mount under Radix Theme so --gray-* / --mv-* tokens resolve (body is outside Theme).
    const host =
      document.querySelector('.radix-themes') ?? document.body;
    host.append(overlay);
    input.focus();
    input.select();
  });
}
