import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Callout, Dialog, Flex, IconButton, Spinner, Text } from '@radix-ui/themes';
import { ExternalLinkIcon, TrashIcon } from '@radix-ui/react-icons';
import type { ShareMeta } from '../../backend/cloud/CloudRepository';
import { getWebAccount } from '../../backend/web/session';
import { shareUrl } from './route';
import { CopyLinkButton, shareErrorMessage } from './ShareDialog';
import './share.css';

const KIND_LABEL: Record<ShareMeta['kind'], string> = { note: 'Note', folder: 'Folder', deck: 'Deck', quiz: 'Quiz' };

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; shares: ShareMeta[] };

/** "My shares": every snapshot link the signed-in user created. Controlled by `open`. */
export function MySharesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const account = getWebAccount();
    if (!account?.user) {
      setState({ status: 'error', message: 'Sign in to see your shares.' });
      return;
    }
    try {
      setState({ status: 'ready', shares: await account.repo.listMyShares(account.user.uid) });
    } catch (error) {
      setState({ status: 'error', message: shareErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setState({ status: 'loading' });
    void refresh();
  }, [open, refresh]);

  const remove = async (share: ShareMeta) => {
    if (!window.confirm(`Delete the link for “${share.title}”? People who have it will no longer be able to open it.`)) return;
    const account = getWebAccount();
    if (!account?.user) return;
    setDeleting(share.shareId);
    try {
      await account.repo.deleteShare(account.user.uid, share.shareId);
      setState((current) =>
        current.status === 'ready' ? { status: 'ready', shares: current.shares.filter((s) => s.shareId !== share.shareId) } : current,
      );
    } catch (error) {
      window.alert(shareErrorMessage(error));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px" aria-describedby={undefined}>
        <Dialog.Title>My shares</Dialog.Title>
        <Text as="p" size="2" color="gray" mb="3">
          Snapshot links you created. Deleting one stops the link from working; copies people already made stay theirs.
        </Text>
        {state.status === 'loading' ? (
          <Flex justify="center" py="5">
            <Spinner />
          </Flex>
        ) : state.status === 'error' ? (
          <Callout.Root color="red" size="1">
            <Callout.Text>{state.message}</Callout.Text>
          </Callout.Root>
        ) : state.shares.length === 0 ? (
          <Text as="p" size="2" color="gray">
            You haven&apos;t shared anything yet. Right-click a note or folder and choose Share….
          </Text>
        ) : (
          <ul className="my-shares">
            {state.shares.map((share) => {
              const url = shareUrl(window.location.origin, share.shareId);
              const created = new Date(share.createdAt);
              return (
                <li key={share.shareId} className="my-share-row">
                  <div className="my-share-info">
                    <Text as="div" size="2" weight="medium" className="my-share-title">
                      {share.title}
                    </Text>
                    <Flex gap="2" align="center">
                      <Badge size="1" color="gray" variant="soft">
                        {KIND_LABEL[share.kind]}
                      </Badge>
                      <Text size="1" color="gray">
                        {Number.isNaN(created.getTime()) ? '' : created.toLocaleString()}
                      </Text>
                    </Flex>
                  </div>
                  <Flex gap="1" align="center">
                    <CopyLinkButton url={url} size="1" />
                    <IconButton size="1" variant="ghost" color="gray" asChild aria-label="Open link">
                      <a href={url} target="_blank" rel="noreferrer">
                        <ExternalLinkIcon />
                      </a>
                    </IconButton>
                    <IconButton
                      size="1"
                      variant="ghost"
                      color="red"
                      aria-label={`Delete link for ${share.title}`}
                      disabled={deleting === share.shareId}
                      onClick={() => void remove(share)}
                    >
                      <TrashIcon />
                    </IconButton>
                  </Flex>
                </li>
              );
            })}
          </ul>
        )}
        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
