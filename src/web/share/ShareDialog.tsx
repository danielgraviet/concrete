import { useEffect, useState } from 'react';
import { Button, Callout, Dialog, Flex, Text, TextField } from '@radix-ui/themes';
import { CheckIcon, CopyIcon } from '@radix-ui/react-icons';
import { getWebAccount } from '../../backend/web/session';
import { collectShare, targetTitle } from './collect';
import { shareUrl } from './route';
import type { ShareController } from './shareController';
import type { ShareTarget } from './types';
import './share.css';

const KIND_LABEL: Record<ShareTarget['kind'], string> = {
  note: 'note',
  folder: 'folder',
  deck: 'flashcard deck',
  quiz: 'quiz',
};

export function shareErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

export function CopyLinkButton({ url, size = '2' }: { url: string; size?: '1' | '2' }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <Button
      size={size}
      variant="soft"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(url)
          .then(() => setCopied(true))
          .catch(() => window.prompt('Copy this link:', url));
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

type State = { status: 'idle' } | { status: 'creating' } | { status: 'done'; url: string } | { status: 'error'; message: string };

function ShareDialogBody({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const title = targetTitle(target);

  const create = async () => {
    setState({ status: 'creating' });
    try {
      const account = getWebAccount();
      if (!account?.user) throw new Error('Sign in to share.');
      await account.flush();
      const input = await collectShare(account.repo, account.user.uid, target);
      const { shareId } = await account.repo.createShare(account.user.uid, input);
      setState({ status: 'done', url: shareUrl(window.location.origin, shareId) });
    } catch (error) {
      setState({ status: 'error', message: shareErrorMessage(error) });
    }
  };

  return (
    <Dialog.Content maxWidth="460px" aria-describedby={undefined}>
      <Dialog.Title>Share {KIND_LABEL[target.kind]}</Dialog.Title>
      <Flex direction="column" gap="3">
        <Text as="p" size="2">
          <strong>{title}</strong>
        </Text>
        <Text as="p" size="2" color="gray">
          Anyone with the link can view it and duplicate it to their own workspace.
          {target.kind === 'deck' ? ' Your review progress is not included.' : null}
          {target.kind === 'quiz' ? ' Your attempts and scores are not included.' : null}
        </Text>
        {state.status === 'done' ? (
          <Flex gap="2" align="center">
            <TextField.Root
              className="share-link-field"
              readOnly
              value={state.url}
              aria-label="Share link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyLinkButton url={state.url} />
          </Flex>
        ) : null}
        <Text as="p" size="1" color="gray">
          This is a snapshot; later edits aren&apos;t included.
        </Text>
        {state.status === 'error' ? (
          <Callout.Root color="red" size="1" role="alert">
            <Callout.Text>{state.message}</Callout.Text>
          </Callout.Root>
        ) : null}
        <Flex gap="2" justify="end" mt="2">
          <Button variant="soft" color="gray" onClick={onClose}>
            {state.status === 'done' ? 'Done' : 'Cancel'}
          </Button>
          {state.status !== 'done' ? (
            <Button onClick={() => void create()} loading={state.status === 'creating'}>
              Create link
            </Button>
          ) : null}
        </Flex>
      </Flex>
    </Dialog.Content>
  );
}

/** Rendered once beside the app; opens when the app calls `controller.open(target)`. */
export function ShareDialogHost({ controller }: { controller: ShareController }) {
  const [target, setTarget] = useState<ShareTarget | null>(controller.current());
  const [key, setKey] = useState(0);
  useEffect(
    () =>
      controller.subscribe((next) => {
        setTarget(next);
        if (next) setKey((k) => k + 1);
      }),
    [controller],
  );
  return (
    <Dialog.Root open={Boolean(target)} onOpenChange={(open) => (!open ? controller.close() : undefined)}>
      {target ? <ShareDialogBody key={key} target={target} onClose={() => controller.close()} /> : null}
    </Dialog.Root>
  );
}
