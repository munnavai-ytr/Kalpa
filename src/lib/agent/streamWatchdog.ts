import type { ChatMessage, ProviderKind } from '@/lib/providers/core';
import type { ProviderProfile } from '@/lib/providers/store';
import { estimateTokens } from './tokens';

export class IdleByteTimeoutError extends Error {
  idleTimeoutMs: number;
  constructor(idleTimeoutMs: number) {
    super(`Idle byte timeout: no bytes received for ${Math.round(idleTimeoutMs / 1000)}s`);
    this.name = 'IdleByteTimeoutError';
    this.idleTimeoutMs = idleTimeoutMs;
  }
}

export function computeSafeMaxOutput(
  profile: ProviderProfile,
  messages: ChatMessage[],
  opts?: { economyOverride?: boolean; multiplier?: number }
): number {
  const promptTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content) + 6, 0);
  const baseWanted = profile.effectiveMaxOutput ?? profile.maxOutputTokens ?? 8192;
  const scaled = opts?.multiplier && opts.multiplier > 1 ? baseWanted * opts.multiplier : baseWanted;
  const economyActive = Boolean(profile.economyMode || opts?.economyOverride);
  const cappedByMode = economyActive ? Math.min(scaled, 4096) : scaled;
  const contextTokens = profile.contextTokens || 128000;
  const room = contextTokens - promptTokens - 512;
  return Math.max(512, Math.min(cappedByMode, room));
}

export function extractReasoningTokens(kind: ProviderKind, json: Record<string, unknown>): number {
  if (kind === 'gemini') {
    const meta = json.usageMetadata as { thoughtsTokenCount?: number } | undefined;
    return typeof meta?.thoughtsTokenCount === 'number' ? meta.thoughtsTokenCount : 0;
  }
  const usage = json.usage as {
    completion_tokens_details?: { reasoning_tokens?: number };
    reasoning_tokens?: number;
  } | undefined;
  return (
    usage?.completion_tokens_details?.reasoning_tokens ??
    usage?.reasoning_tokens ??
    0
  );
}

/**
 * Wraps an upstream ReadableStream so that EVERY incoming byte chunk (including SSE `: ping\n\n`
 * comments) resets the idle watchdog timer. Long streams never time out while bytes arrive.
 */
export function watchReadableBytes(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
  onTimeout: () => void
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      onTimeout();
      try {
        void reader.cancel(new IdleByteTimeoutError(idleTimeoutMs));
      } catch {
        // ignore
      }
    }, idleTimeoutMs);
  };

  return new ReadableStream<Uint8Array>({
    start() {
      arm();
    },
    async pull(controller) {
      arm();
      try {
        const { value, done } = await reader.read();
        if (done) {
          if (timer) clearTimeout(timer);
          reader.releaseLock();
          controller.close();
          return;
        }
        arm();
        if (value) controller.enqueue(value);
      } catch (err) {
        if (timer) clearTimeout(timer);
        reader.releaseLock();
        controller.error(err);
      }
    },
    cancel(reason) {
      if (timer) clearTimeout(timer);
      reader.releaseLock();
      return body.cancel(reason);
    },
  });
}

export async function sleepWithCountdown(
  totalMs: number,
  signal: AbortSignal | undefined,
  onTick: (remainingSec: number) => void
): Promise<void> {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const remSec = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
    onTick(remSec);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, Math.min(1000, Math.max(100, deadline - Date.now())));
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

export async function waitUntilVisibleAndOnline(
  signal: AbortSignal | undefined,
  onWaitNotice: (text: string) => void
): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  while (!signal?.aborted) {
    const hidden = document.visibilityState === 'hidden';
    const offline = navigator.onLine === false;
    if (!hidden && !offline) return;
    onWaitNotice(
      offline
        ? 'Offline — waiting for network connection to resume…'
        : 'Tab returned from background — resuming build…'
    );
    await new Promise<void>((resolve) => {
      const done = () => {
        document.removeEventListener('visibilitychange', done);
        window.removeEventListener('online', done);
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(done, 1500);
      document.addEventListener('visibilitychange', done, { once: true });
      window.addEventListener('online', done, { once: true });
    });
  }
}
