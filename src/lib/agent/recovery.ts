import {
  buildRequest,
  parseEvent,
  ProviderHttpError,
  sseData,
  type ChatMessage,
  type ProviderConfig,
  type StreamEvent,
} from '@/lib/providers/core';
import { useProviderStore, type ProviderProfile } from '@/lib/providers/store';
import {
  backoffMs,
  classifyProviderError,
  reducedMaxTokens,
  type ClassifiedError,
} from './reliability';
import {
  computeSafeMaxOutput,
  extractReasoningTokens,
  IdleByteTimeoutError,
  sleepWithCountdown,
  waitUntilVisibleAndOnline,
  watchReadableBytes,
} from './streamWatchdog';

export interface RecoveryNotice {
  kind: 'retry_countdown' | 'auto_cap' | 'compacting' | 'profile_switched' | 'info' | 'warn';
  text: string;
  attempt?: number;
  maxAttempts?: number;
  remainingSec?: number;
  persistent?: boolean;
}

export interface RecoveryStreamEvent extends StreamEvent {
  reasoningTokens?: number;
}

export class StreamInterruptedError extends Error {
  partialText: string;
  causeError: unknown;
  constructor(partialText: string, causeError: unknown) {
    super('Stream interrupted after receiving partial response');
    this.name = 'StreamInterruptedError';
    this.partialText = partialText;
    this.causeError = causeError;
  }
}

export class TerminalProviderError extends Error {
  classified: ClassifiedError;
  status?: number;
  rawDetail: string;
  suggestProxy: boolean;
  profile: ProviderProfile;
  constructor(opts: {
    classified: ClassifiedError;
    status?: number;
    rawDetail: string;
    suggestProxy: boolean;
    profile: ProviderProfile;
  }) {
    super(opts.classified.message);
    this.name = 'TerminalProviderError';
    this.classified = opts.classified;
    this.status = opts.status;
    this.rawDetail = opts.rawDetail;
    this.suggestProxy = opts.suggestProxy;
    this.profile = opts.profile;
  }
}

export interface StreamWithRecoveryOptions {
  signal?: AbortSignal;
  idleTimeoutMs?: number;
  economyOverride?: boolean;
  outputTokenMultiplier?: number;
  onNotice?: (notice: RecoveryNotice | null) => void;
  onProfileSwitched?: (nextProfile: ProviderProfile) => void;
  onCompactContext?: () => Promise<ChatMessage[]>;
}

async function* openGuardedStream(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  idleTimeoutMs: number,
  outerSignal?: AbortSignal
): AsyncGenerator<RecoveryStreamEvent> {
  const attemptAbort = new AbortController();
  let timedOutByWatchdog = false;
  const onOuterAbort = () => attemptAbort.abort();
  if (outerSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
  outerSignal?.addEventListener('abort', onOuterAbort, { once: true });

  const headerTimer = setTimeout(() => {
    timedOutByWatchdog = true;
    attemptAbort.abort();
  }, idleTimeoutMs);

  try {
    const { url, init } = buildRequest(cfg, messages);
    let res: Response;
    try {
      res = cfg.useProxy
        ? await fetch('/api/proxy', {
            method: 'POST',
            signal: attemptAbort.signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              url,
              method: init.method,
              headers: init.headers,
              body: init.body,
            }),
          })
        : await fetch(url, { ...init, signal: attemptAbort.signal });
    } catch (err) {
      if (timedOutByWatchdog && !outerSignal?.aborted) {
        throw new IdleByteTimeoutError(idleTimeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(headerTimer);
    }

    if (!res.ok || !res.body) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 1200); } catch { /* ignore */ }
      throw new ProviderHttpError(res.status, res.statusText, detail, res.headers.get('retry-after'));
    }

    const watched = watchReadableBytes(res.body, idleTimeoutMs, () => {
      timedOutByWatchdog = true;
      attemptAbort.abort();
    });

    try {
      for await (const data of sseData(watched)) {
        if (data === '[DONE]') {
          yield { done: true };
          return;
        }
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (json.error && typeof json.error === 'object') {
          const errObj = json.error as { code?: number; message?: string };
          throw new ProviderHttpError(
            typeof errObj.code === 'number' ? errObj.code : 500,
            'StreamError',
            JSON.stringify(json.error)
          );
        }
        const reasoningTokens = extractReasoningTokens(cfg.kind, json);
        const ev = parseEvent(cfg.kind, json);
        if (ev || reasoningTokens > 0) {
          yield { ...(ev ?? {}), ...(reasoningTokens > 0 ? { reasoningTokens } : {}) };
        }
      }
    } catch (err) {
      if (timedOutByWatchdog && !outerSignal?.aborted) {
        throw new IdleByteTimeoutError(idleTimeoutMs);
      }
      throw err;
    }
  } finally {
    clearTimeout(headerTimer);
    outerSignal?.removeEventListener('abort', onOuterAbort);
  }
}

export async function* streamWithRecovery(
  initialProfile: ProviderProfile,
  initialMessages: ChatMessage[],
  opts: StreamWithRecoveryOptions = {}
): AsyncGenerator<RecoveryStreamEvent> {
  const idleTimeoutMs = opts.idleTimeoutMs ?? 120_000;
  let profile = initialProfile;
  let messages = initialMessages;
  let compactedOnce = false;
  let rateLimitAttempts = 0;
  let transientAttempts = 0;
  const triedProfileIds = new Set<string>([profile.id]);

  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await waitUntilVisibleAndOnline(opts.signal, (text) =>
      opts.onNotice?.({ kind: 'info', text })
    );

    const safeMaxTokens = computeSafeMaxOutput(profile, messages, {
      economyOverride: opts.economyOverride,
      multiplier: opts.outputTokenMultiplier,
    });
    const cfg: ProviderConfig = {
      kind: profile.kind,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      maxOutputTokens: safeMaxTokens,
      temperature: profile.temperature,
      useProxy: profile.useProxy,
      extraBody: profile.extraBody,
    };

    let emittedText = '';
    try {
      for await (const ev of openGuardedStream(cfg, messages, idleTimeoutMs, opts.signal)) {
        if (ev.delta) {
          if (!emittedText) opts.onNotice?.(null);
          emittedText += ev.delta;
        }
        yield ev;
      }
      opts.onNotice?.(null);
      return;
    } catch (err) {
      if (opts.signal?.aborted) throw err;

      // A4: If partial deltas already arrived before disconnect/timeout, preserve & resume cleanly
      if (emittedText.trim().length > 0) {
        throw new StreamInterruptedError(emittedText, err);
      }

      const isLocalHost = /localhost|127\.0\.0\.1/.test(profile.baseUrl);
      const classified = classifyProviderError(err, { isLocalHost });
      const rawDetail =
        err instanceof ProviderHttpError
          ? `${err.status} ${err.statusText}\n${err.body}`.trim()
          : err instanceof Error
            ? err.message
            : String(err);

      // A9: Track repeated quota/credit errors -> auto-enable Economy mode on this profile
      if (
        classified.kind === 'max_tokens_affordable' ||
        classified.kind === 'insufficient_credit' ||
        classified.kind === 'daily_quota' ||
        classified.kind === 'rate_limit'
      ) {
        const nextCount = (profile.quotaErrorCount ?? 0) + 1;
        const autoEconomy = nextCount >= 2 && !profile.economyMode;
        profile = {
          ...profile,
          quotaErrorCount: nextCount,
          ...(autoEconomy ? { economyMode: true } : {}),
        };
        void useProviderStore.getState().patchProfileMeta(profile.id, {
          quotaErrorCount: nextCount,
          ...(autoEconomy ? { economyMode: true } : {}),
        });
        if (autoEconomy) {
          opts.onNotice?.({
            kind: 'auto_cap',
            text: `Auto-enabled Economy mode (4k cap) on ${profile.label} after repeated quota warnings.`,
            persistent: true,
          });
        }
      }

      // A3: OpenRouter 402 affordable max_tokens auto-reduction
      if (classified.kind === 'max_tokens_affordable' && classified.affordableTokens) {
        const nextMax = reducedMaxTokens(safeMaxTokens, classified.affordableTokens);
        if (nextMax < safeMaxTokens) {
          profile = { ...profile, effectiveMaxOutput: nextMax };
          void useProviderStore.getState().patchProfileMeta(profile.id, { effectiveMaxOutput: nextMax });
          opts.onNotice?.({
            kind: 'auto_cap',
            text: `Reduced max output tokens to ${nextMax} (key credit limit) — retrying…`,
            persistent: true,
          });
          continue;
        }
      }

      // A3: Context window exceeded -> compact once and retry immediately
      if (classified.kind === 'context_too_long' && !compactedOnce && opts.onCompactContext) {
        compactedOnce = true;
        opts.onNotice?.({
          kind: 'compacting',
          text: 'Context window full — compacting history and selected files…',
          persistent: true,
        });
        messages = await opts.onCompactContext();
        continue;
      }

      // A3/A9: Switch to next ordered fallback profile on quota/credit/model errors
      const store = useProviderStore.getState();
      if (classified.switchModel && store.autoSwitchOnQuota && store.fallbackProfileIds.length > 0) {
        const nextFb = store.fallbackProfileIds
          .map((id) => store.profiles.find((p) => p.id === id))
          .find((p): p is ProviderProfile => Boolean(p && (p.apiKey || /localhost|127\.0\.0\.1/.test(p.baseUrl)) && !triedProfileIds.has(p.id)));
        if (nextFb) {
          triedProfileIds.add(nextFb.id);
          const prevLabel = `${profile.label} (${profile.model})`;
          profile = nextFb;
          void store.setActiveProfile(nextFb.id);
          opts.onProfileSwitched?.(nextFb);
          opts.onNotice?.({
            kind: 'profile_switched',
            text: `Switched from ${prevLabel} to ${nextFb.label} (${nextFb.model}) after ${classified.kind.replace(/_/g, ' ')}.`,
            persistent: true,
          });
          rateLimitAttempts = 0;
          transientAttempts = 0;
          continue;
        }
      }

      // A3: Per-minute rate limit -> up to 6 attempts with live 1s countdown
      if (classified.kind === 'rate_limit' && rateLimitAttempts < 6) {
        rateLimitAttempts++;
        const waitMs = backoffMs(rateLimitAttempts, classified.retryAfterMs);
        await sleepWithCountdown(waitMs, opts.signal, (remSec) => {
          opts.onNotice?.({
            kind: 'retry_countdown',
            text: `Rate limit — retrying in ${remSec}s (attempt ${rateLimitAttempts}/6)`,
            attempt: rateLimitAttempts,
            maxAttempts: 6,
            remainingSec: remSec,
          });
        });
        continue;
      }

      // A3: Overloaded / timeout / network -> up to 5 attempts with live 1s countdown
      if (
        (classified.kind === 'overloaded' ||
          classified.kind === 'timeout' ||
          classified.kind === 'network') &&
        transientAttempts < 5
      ) {
        transientAttempts++;
        const waitMs = backoffMs(transientAttempts, classified.retryAfterMs);
        const label =
          classified.kind === 'overloaded'
            ? 'Provider busy'
            : classified.kind === 'timeout'
              ? 'Stream stalled'
              : 'Network hiccup';
        await sleepWithCountdown(waitMs, opts.signal, (remSec) => {
          opts.onNotice?.({
            kind: 'retry_countdown',
            text: `${label} — retrying in ${remSec}s (attempt ${transientAttempts}/5)`,
            attempt: transientAttempts,
            maxAttempts: 5,
            remainingSec: remSec,
          });
        });
        continue;
      }

      opts.onNotice?.(null);
      throw new TerminalProviderError({
        classified,
        status: classified.status,
        rawDetail,
        suggestProxy: !profile.useProxy && classified.kind === 'cors_or_blocked',
        profile,
      });
    }
  }
}
