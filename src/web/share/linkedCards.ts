import type { CloudUser } from '../../backend/cloud/AuthProvider';
import { cloudRootFor } from '../../backend/web/cloudVault';
import type { WebSession } from '../../backend/web/session';
import { LinkedCardStore } from '../../learn/LinkedCardStore';
import type { NewLinkedCard } from './duplicate';

/**
 * Create app cards in `user`'s workspace through the normal LinkedCardStore
 * path (mounting the user's cloud vault first), then flush to the repository.
 * New cards carry no review state: they start fresh for the recipient.
 */
export function linkedCardWriter(session: WebSession, user: CloudUser) {
  return async (items: NewLinkedCard[]): Promise<void> => {
    session.attachUser(user);
    const store = new LinkedCardStore(cloudRootFor(user.uid));
    await store.load();
    if (!store.isWritable) throw new Error('Could not open your flashcards. Try again in a moment.');
    await store.addMany(items);
    await session.currentVault()?.flushAll();
  };
}
