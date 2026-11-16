import { useEffect, useState } from 'react';
import { Flex, Progress, Select, Text } from '@radix-ui/themes';
import { getBackend } from '../backend';
import { getAiProxyClient, type AiProxyQuota } from '../backend/web';
import {
  OPENROUTER_MODEL_OPTIONS,
  openRouterModelLabel,
  resolveOpenRouterModelId,
} from '../ai/openRouterModels';
import { formatQuotaUsage, quotaErrorText, quotaPercent } from './aiQuota';

type QuotaState =
  | { kind: 'loading' }
  | { kind: 'ready'; quota: AiProxyQuota }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable' };

/**
 * Tutor AI settings on the web build: AI always runs on OpenRouter through the
 * proxy (which holds the key), so there is no provider choice or key entry —
 * just a model picker limited to the curated models, status and the monthly quota.
 * Fetches when `active` (the AI tab is shown) becomes true.
 */
export function WebAiSection({
  active,
  modelId,
  onModelChange,
}: {
  active: boolean;
  modelId: string;
  onModelChange: (modelId: string) => void;
}) {
  const selectedModel = resolveOpenRouterModelId(modelId);
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
      <Text size="2">OpenRouter · {openRouterModelLabel(selectedModel)}</Text>
      <Select.Root value={selectedModel} onValueChange={onModelChange}>
        <Select.Trigger placeholder="Model" aria-label="AI model" />
        <Select.Content>
          {OPENROUTER_MODEL_OPTIONS.map((model) => (
            <Select.Item key={model.id} value={model.id}>
              {model.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <Text size="1" color="gray">
        {OPENROUTER_MODEL_OPTIONS.find((model) => model.id === selectedModel)?.description}
      </Text>
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
