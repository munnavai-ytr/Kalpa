'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Info,
  Play,
  Settings,
} from 'lucide-react';
import { APP_NAME, APP_VERSION } from '@/lib/brand';
import {
  executeDiagnosticsSuite,
  INITIAL_DIAGNOSTIC_CHECKS,
  type DiagItem,
} from '@/lib/diagnosticsRunner';
import { useUiStore } from '@/stores/ui';
import { Logo } from '@/components/brand/Logo';
import { AuroraBackground } from '@/components/brand/AuroraBackground';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { SandpackSelfTest } from '@/components/settings/SandpackSelfTest';

export default function DiagnosticsPage() {
  const addToast = useUiStore((s) => s.addToast);

  const [checks, setChecks] = useState<DiagItem[]>(INITIAL_DIAGNOSTIC_CHECKS);
  const [runningAll, setRunningAll] = useState(false);
  const [spRunNonce, setSpRunNonce] = useState(0);

  const upsertCheck = useCallback((item: DiagItem) => {
    setChecks((prev) => {
      const idx = prev.findIndex((x) => x.id === item.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = item;
        return copy;
      }
      return [...prev, item];
    });
  }, []);

  const runDiagnostics = useCallback(async () => {
    setRunningAll(true);
    setChecks(INITIAL_DIAGNOSTIC_CHECKS);
    setSpRunNonce((n) => n + 1);
    await executeDiagnosticsSuite(upsertCheck);
    setRunningAll(false);
  }, [upsertCheck]);

  useEffect(() => {
    void runDiagnostics();
  }, [runDiagnostics]);

  const handleCopyReport = async () => {
    const lines = [
      `${APP_NAME} v${APP_VERSION} Diagnostics Report`,
      `Generated: ${new Date().toISOString()}`,
      '----------------------------------------',
      ...checks.map(
        (c) =>
          `[${c.state}] ${c.label}${c.durationMs !== undefined ? ` (${c.durationMs} ms)` : ''}: ${c.detail}`
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      addToast({ title: 'Diagnostics report copied', kind: 'success' });
    } catch {
      addToast({ title: 'Could not copy to clipboard', kind: 'error' });
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <AuroraBackground />

      <header className="sticky top-0 z-30 kalpa-glass border-b border-kalpa-border pt-safe">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-kalpa-muted hover:text-kalpa-text min-h-[44px] pr-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Home</span>
            </Link>
            <Logo size="sm" />
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-kalpa-muted hover:text-kalpa-text min-h-[44px] px-2"
          >
            <Settings className="w-4 h-4" />
            Settings
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 pb-safe">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-kalpa-text">
              System Diagnostics
            </h1>
            <p className="text-sm text-kalpa-muted">
              Live browser verification for IndexedDB, Web Workers, Pyodide, Sandpack, and BYOK streaming.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={runningAll}
              leftIcon={<Play className="w-3.5 h-3.5" />}
              onClick={runDiagnostics}
            >
              Re-run checks
            </Button>
            <Button
              size="sm"
              variant="primary"
              leftIcon={<Copy className="w-3.5 h-3.5" />}
              onClick={handleCopyReport}
            >
              Copy report
            </Button>
          </div>
        </div>

        <Card padding="none" className="divide-y divide-kalpa-border overflow-hidden">
          {checks.map((item) => (
            <div
              key={item.id}
              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="space-y-1 min-w-0 flex-1">
                <p className="text-sm font-medium text-kalpa-text">{item.label}</p>
                <p className="text-xs font-mono text-kalpa-muted break-words">{item.detail}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {item.durationMs !== undefined ? (
                  <span className="text-xs font-mono tabular-nums text-kalpa-muted">
                    {item.durationMs} ms
                  </span>
                ) : null}
                {item.state === 'RUNNING' ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-mono text-kalpa-violet">
                    <Spinner size={13} /> RUNNING
                  </span>
                ) : item.state === 'PASS' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-kalpa-success">
                    <CheckCircle2 className="w-3.5 h-3.5" /> PASS
                  </span>
                ) : item.state === 'FAIL' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-kalpa-danger">
                    <AlertCircle className="w-3.5 h-3.5" /> FAIL
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-kalpa-gold">
                    <Info className="w-3.5 h-3.5" /> INFO
                  </span>
                )}
              </div>
            </div>
          ))}
        </Card>

        {spRunNonce > 0 ? (
          <Card className="space-y-2">
            <p className="text-xs font-semibold text-kalpa-muted">
              Live Sandpack Self-Test Frame
            </p>
            <SandpackSelfTest
              runNonce={spRunNonce}
              onResult={(res) => {
                upsertCheck({
                  id: 'sandpack',
                  label: 'Sandpack Render Self-Test',
                  state: res.ok ? 'PASS' : 'FAIL',
                  durationMs: res.durationMs,
                  detail: res.detail,
                });
              }}
            />
          </Card>
        ) : null}
      </main>
    </div>
  );
}
