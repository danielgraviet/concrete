/**
 * Phone detection for the web app: narrow viewport + touch input gets the
 * dedicated mobile shell; tablets and small desktop windows keep the desktop
 * layout (it already auto-collapses its sidebars on narrow widths).
 *
 * Checked once at startup: swapping shells live would drop app state, and
 * phones do not cross the boundary during a session (rotation stays < 768px).
 */
export function isPhoneScreen(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const narrow = window.innerWidth <= 767;
  if (!narrow) return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  return coarse || noHover;
}
