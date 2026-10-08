import { useEffect, useState } from 'react';
import { Button, Flex, Link, Text, TextField } from '@radix-ui/themes';
import { DAYTONA_KEYS_URL, getSandboxKeyStatus, setSandboxApiKey, type SandboxKeyStatus } from '../sandbox';

type Props = {
  /** Called after the key changes so the runner status can refresh. */
  onChange: () => void;
};

/** Daytona API key entry for the cloud code runner. */
export function DaytonaKeyField({ onChange }: Props) {
  const [status, setStatus] = useState<SandboxKeyStatus | null>(null);
  const [input, setInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void getSandboxKeyStatus().then(setStatus);
  }, []);

  const save = (value: string, done: string) => {
    void setSandboxApiKey(value)
      .then((next) => {
        setStatus(next);
        setInput('');
        setMessage(done);
        onChange();
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Could not save key.'));
  };

  return (
    <>
      {status?.origin === 'env' ? (
        <Text size="1" color="green">
          ✓ Using DAYTONA_API_KEY from the environment{status.keySuffix ? ` (ending …${status.keySuffix})` : ''}.
          {' '}It takes priority over a key saved here.
        </Text>
      ) : status?.configured ? (
        <Text size="1" color="green">
          ✓ Daytona key saved{status.keySuffix ? ` (ending …${status.keySuffix})` : ''}. Enter a new key only to replace it.
        </Text>
      ) : (
        <Text size="1" color="gray">
          Daytona runs code in a cloud sandbox, so nothing needs installing. Add your API key to use it.
        </Text>
      )}
      <TextField.Root
        type="password"
        placeholder={status?.configured ? 'Replace Daytona API key (optional)' : 'Daytona API key'}
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />
      <Flex align="center" gap="2" wrap="wrap">
        <Button
          type="button"
          variant="soft"
          disabled={!input.trim()}
          onClick={() => save(input.trim(), 'Key saved.')}
        >
          Save key
        </Button>
        {status?.origin === 'saved' ? (
          <Button type="button" variant="soft" color="gray" onClick={() => save('', 'Key removed.')}>
            Remove key
          </Button>
        ) : null}
        <Link size="1" href={DAYTONA_KEYS_URL} target="_blank" rel="noreferrer">
          Get a Daytona API key →
        </Link>
        {message ? <Text size="1" color="gray">{message}</Text> : null}
      </Flex>
      <Text size="1" color="gray">
        Stored locally on this device and never shown again. Runs are billed to your Daytona account.
      </Text>
    </>
  );
}
