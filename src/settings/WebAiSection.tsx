import { useEffect, useState } from 'react';
import { Flex, Progress, Text } from '@radix-ui/themes';
import { getBackend } from '../backend';
import { getAiProxyClient, type AiProxyQuota } from '../backend/web';
import { formatQuotaUsage, quotaErrorText, quotaPercent } from './aiQuota';

type QuotaState =
  | { kind: 'loading' }
  | { kind: 'ready'; quota: AiProxyQuota }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable' };

/**
 * Tutor AI settings on the web build: the server picks the model, so there is
 * no provider/model choice or key entry — just status and the monthly quota.
 * Fetches when `active` (the AI tab is shown) becomes true.
 */
export function WebAiSection({ active }: { active: boolean }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [quota, setQuota] = useState<QuotaState>({ kind: 'loading' });

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const ai = getBackend().ai;
    void ai?.status().then((next) => {
      if (!cancelled) setStatus(next);
    }).catch(() => {});

    const client = getAiProxyClient();
    if (!client) {
      setQuota({ kind: 'unavailable' });
      return () => {
        cancelled = true;
      };
    }
    const controller = new AbortController();
    setQuota((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    void client.getQuota({ signal: controller.signal }).then(
      (next) => {
        if (!cancelled) setQuota({ kind: 'ready', quota: next });
      },
      (error: unknown) => {
        if (!cancelled) setQuota({ kind: 'error', message: quotaErrorText(error) });
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [active]);

  const percent = quota.kind === 'ready' ? quotaPercent(quota.quota) : null;

  return (
    <>
      <Text size="2">Concrete AI</Text>
      {status?.message ? (
        <Text size="1" color={status.configured ? 'green' : 'gray'}>
          {status.configured ? '✓ ' : ''}{status.message}
        </Text>
      ) : null}
      <Flex direction="column" gap="1" aria-live="polite">
        {quota.kind === 'loading' ? (
          <Text size="1" color="gray">Loading AI usage…</Text>
        ) : quota.kind === 'unavailable' ? (
          <Text size="1" color="gray">AI isn&apos;t configured for this site yet.</Text>
        ) : quota.kind === 'error' ? (
          <Text size="1" color="gray">{quota.message}</Text>
        ) : (
          <>
            {percent !== null ? (
              <Progress
                value={percent}
                size="1"
                color={percent >= 100 ? 'red' : percent >= 80 ? 'amber' : undefined}
                aria-label="AI actions used this month"
              />
            ) : null}
            <Text size="1" color={percent !== null && percent >= 100 ? 'red' : 'gray'}>
              {formatQuotaUsage(quota.quota)}
            </Text>
          </>
        )}
      </Flex>
      <Text size="1" color="gray">
        Each quiz, grade, card fill, or tutor message uses AI actions from your monthly allowance.
      </Text>
    </>
  );
}
