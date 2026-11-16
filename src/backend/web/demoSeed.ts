import type { CloudRepository, CloudUser } from '../cloud';

/** Local user for `npm run dev:web` without Firebase. */
export const DEMO_USER: CloudUser = {
  uid: 'demo',
  email: null,
  displayName: 'Demo',
  photoURL: null,
};

const DEMO_NOTES: Record<string, string> = {
  'Welcome.md':
    '# Welcome to Concrete on the web\n\n' +
    'This is a **local demo**: notes live in memory and disappear when you reload. ' +
    'Set the `VITE_FIREBASE_*` values in `.env` to sign in with Google and sync to the cloud.\n\n' +
    '- Link notes with [[Ideas]]\n' +
    '- Write cards as `question :: answer` and study them in Review\n\n' +
    'What does Concrete store notes as? :: Plain Markdown.\n',
  'Ideas.md': '# Ideas\n\nCapture quickly. Organize later.\n\nBack to [[Welcome]].\n',
  'Stats/Overview.md': '# Stats\n\nNotes living under the **Stats** folder.\n',
};

/** Fill an empty in-memory workspace with a few notes. */
export async function seedDemoWorkspace(repo: CloudRepository, ws: string = DEMO_USER.uid): Promise<void> {
  const tree = await repo.listTree(ws);
  if (tree.notes.length) return;
  for (const [path, body] of Object.entries(DEMO_NOTES)) await repo.writeNote(ws, path, body);
}
