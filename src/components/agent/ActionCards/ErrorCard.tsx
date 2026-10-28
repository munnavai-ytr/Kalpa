'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Layers,
  RotateCcw,
  Settings,
  ShieldCheck,
  Shuffle,
} from 'lucide-react';
import type { ProviderKind } from '@/lib/providers/core';
import { getProviderKeyPageUrl } from '@/lib/providers/credits';
import { Button } from '@/components/ui/Button';
import { useUiStore } from '@/stores/ui';

export interface ErrorCardProps {
  message: string;
  hint?: string;
  kind?: string;
  rawDetail?: string;
  extraBodyHint?: string;
  suggestProxy?: boolean;
  providerKind?: ProviderKind;
  baseUrl?: string;
  onRetry?: () => void;
  onEnableProxyAndRetry?: () => void;
  onSwitchModel?: () => void;
}

export function ErrorCard({
  message,
  hint,
  kind,
  rawDetail,
  extraBodyHint,
  suggestProxy,
  providerKind,
  baseUrl,
  onRetry,
  onEnableProxyAndRetry,
  onSwitchModel,
}: ErrorCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const openModelSheet = useUiStore((s) => s.setModelSheetOpen);

  const keyDashboard =
    providerKind && baseUrl ? getProviderKeyPageUrl(providerKind, baseUrl) : null;

  const showSwitchBtn =
    kind === 'daily_quota' ||
    kind === 'no_free_quota' ||
    kind === 'insufficient_credit' ||
    kind === 'model_not_found' ||
    kind === 'no_actions' ||
    kind === 'empty_reply' ||
    kind === 'overloaded';

  const showFallbackBtn =
    kind === 'daily_quota' ||
    kind === 'no_free_quota' ||
    kind === 'insufficient_credit';

  const showKeyDashboardLink =
    keyDashboard &&
    (kind === 'auth' ||
      kind === 'insufficient_credit' ||
      kind === 'daily_quota' ||
      kind === 'no_free_quota');

  return (
    <div className="rounded-[12px] border border-kalpa-danger/45 bg-kalpa-danger/10 p-3.5 space-y-2.5 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-kalpa-danger shrink-0 mt-0.5" />
        <div className="space-y-1 flex-1 min-w-0">
          <p className="text-kalpa-text font-medium leading-relaxed break-words">{message}</p>
          {hint ? (
            <p className="text-kalpa-muted leading-relaxed break-words">{hint}</p>
          ) : null}
          {extraBodyHint ? (
            <div className="mt-1.5 rounded-[8px] bg-kalpa-bg-1/80 border border-kalpa-border px-2.5 py-1.5 font-mono text-[11px] text-kalpa-text break-all">
              Extra JSON body hint: {extraBodyHint}
            </div>
          ) : null}
        </div>
      </div>

      {rawDetail && rawDetail !== message ? (
        <div>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-kalpa-muted hover:text-kalpa-text cursor-pointer"
          >
            {showDetails ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            Details
          </button>
          {showDetails ? (
            <pre className="mt-1.5 max-h-36 overflow-auto rounded-[8px] bg-kalpa-bg-0/90 border border-kalpa-border p-2 text-[11px] font-mono text-kalpa-muted whitespace-pre-wrap break-all">
              {rawDetail}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {suggestProxy && onEnableProxyAndRetry ? (
          <Button
            size="sm"
            variant="primary"
            leftIcon={<ShieldCheck className="w-3.5 h-3.5" />}
            onClick={onEnableProxyAndRetry}
          >
            Enable Proxy &amp; Retry
          </Button>
        ) : null}

        {onRetry ? (
          <Button
            size="sm"
            variant={suggestProxy ? 'secondary' : 'primary'}
            leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={onRetry}
          >
            Retry
          </Button>
        ) : null}

        {showSwitchBtn ? (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Shuffle className="w-3.5 h-3.5" />}
            onClick={() => (onSwitchModel ? onSwitchModel() : openModelSheet(true))}
          >
            Switch model
          </Button>
        ) : null}

        {showFallbackBtn ? (
          <Link href="/settings">
            <Button size="sm" variant="secondary" leftIcon={<Layers className="w-3.5 h-3.5" />}>
              Add fallback key
            </Button>
          </Link>
        ) : null}

        {showKeyDashboardLink ? (
          <a
            href={keyDashboard.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 min-h-[34px] px-2.5 rounded-[10px] border border-kalpa-border bg-kalpa-surface hover:bg-kalpa-bg-2 text-kalpa-text font-medium transition-colors"
          >
            <span>Open {keyDashboard.label}</span>
            <ExternalLink className="w-3 h-3 text-kalpa-muted" />
          </a>
        ) : null}

        <Link href="/settings">
          <Button size="sm" variant="ghost" leftIcon={<Settings className="w-3.5 h-3.5" />}>
            Settings
          </Button>
        </Link>
      </div>
    </div>
  );
}
