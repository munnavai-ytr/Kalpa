'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw, Settings, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface ErrorCardProps {
  message: string;
  suggestProxy?: boolean;
  onRetry?: () => void;
  onEnableProxyAndRetry?: () => void;
}

export function ErrorCard({
  message,
  suggestProxy,
  onRetry,
  onEnableProxyAndRetry,
}: ErrorCardProps) {
  return (
    <div className="rounded-[12px] border border-kalpa-danger/45 bg-kalpa-danger/10 p-3.5 space-y-2.5 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-kalpa-danger shrink-0 mt-0.5" />
        <p className="text-kalpa-text leading-relaxed break-words flex-1">{message}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
            variant="secondary"
            leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={onRetry}
          >
            Retry
          </Button>
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
