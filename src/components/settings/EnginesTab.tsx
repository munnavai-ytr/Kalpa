'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Cpu,
  Eye,
  EyeOff,
  Play,
} from 'lucide-react';
import { runE2bSelfTest, type E2bSelfTestStep } from '@/lib/sandbox/e2b';
import { useProviderStore } from '@/lib/providers/store';
import { useUiStore } from '@/stores/ui';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export function EnginesTab() {
  const e2bApiKey = useProviderStore((s) => s.e2bApiKey);
  const setE2bApiKey = useProviderStore((s) => s.setE2bApiKey);
  const addToast = useUiStore((s) => s.addToast);

  const [draftKey, setDraftKey] = useState(e2bApiKey);
  const [reveal, setReveal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    totalMs: number;
    steps: E2bSelfTestStep[];
    error?: string;
  } | null>(null);

  useEffect(() => {
    setDraftKey(e2bApiKey);
  }, [e2bApiKey]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await setE2bApiKey(draftKey.trim());
    addToast({ title: 'Cloud Sandbox E2B key saved in local vault', kind: 'success' });
  };

  const handleSelfTest = async () => {
    const key = draftKey.trim();
    if (!key) {
      addToast({ title: 'Enter an E2B API key first', kind: 'warn' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      if (key !== e2bApiKey) {
        await setE2bApiKey(key);
      }
      const res = await runE2bSelfTest(key);
      setTestResult(res);
      addToast({
        title: res.ok ? `E2B Sandbox verified (${res.totalMs} ms)` : 'E2B Sandbox test failed',
        kind: res.ok ? 'success' : 'error',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <div className="flex items-center gap-2.5">
          <Cpu className="w-4 h-4 text-kalpa-success shrink-0" />
          <h3 className="text-sm font-semibold text-kalpa-text">Engine A: Instant (Browser Runtime)</h3>
        </div>
        <p className="text-sm text-kalpa-muted leading-relaxed">
          Runs 100% inside your browser with zero server setup or sandbox fees. Instant supports
          static HTML/CSS/JS sites, client-side React/Vue/Svelte/Solid apps via Sandpack, Next.js
          App Router client routes via Next-Lite, Python 3 via Pyodide WebAssembly, and JavaScript
          worker scripts.
        </p>
        <div className="pt-1 text-xs text-kalpa-muted space-y-1">
          <p className="font-medium text-kalpa-text">When to switch to Cloud Sandbox:</p>
          <p>· Server-only Next.js features (API routes, Server Actions, async Server Components, middleware).</p>
          <p>· Full Linux CLI tools (npm, git, pytest, cargo, native compilers) and real interactive PTY.</p>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Cloud className="w-4 h-4 text-kalpa-violet shrink-0" />
            <h3 className="text-sm font-semibold text-kalpa-text">
              Engine B: Cloud Sandbox (E2B Linux microVM)
            </h3>
          </div>
          {e2bApiKey ? (
            <span className="text-xs font-mono text-kalpa-success">Key configured</span>
          ) : null}
        </div>

        <p className="text-sm text-kalpa-muted leading-relaxed">
          Boots an isolated Ubuntu Linux microVM directly from your browser using your own E2B key.
          Your local IndexedDB Virtual File System remains the single source of truth; changes sync
          both ways automatically.
        </p>

        <form onSubmit={handleSave} className="space-y-3">
          <label className="block text-xs font-medium text-kalpa-muted">
            E2B API Key (stored only in your browser vault)
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <input
                type={reveal ? 'text' : 'password'}
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                placeholder="e2b_..."
                autoComplete="off"
                className="w-full min-h-[44px] pl-3.5 pr-11 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono text-kalpa-text"
              />
              <button
                type="button"
                aria-label={reveal ? 'Hide E2B key' : 'Reveal E2B key'}
                onClick={() => setReveal((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-kalpa-muted hover:text-kalpa-text cursor-pointer"
              >
                {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button type="submit" variant="secondary">
              Save Key
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={testing}
              leftIcon={<Play className="w-3.5 h-3.5" />}
              onClick={handleSelfTest}
            >
              Test Connection
            </Button>
          </div>
        </form>

        {testResult ? (
          <div className="rounded-[12px] border border-kalpa-border bg-kalpa-bg p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between font-semibold">
              <span className={testResult.ok ? 'text-kalpa-success' : 'text-kalpa-danger'}>
                {testResult.ok
                  ? 'All Cloud Sandbox probes passed'
                  : `Sandbox check failed: ${testResult.error || 'see steps below'}`}
              </span>
              <span className="font-mono text-kalpa-muted">{testResult.totalMs} ms</span>
            </div>

            <div className="divide-y divide-kalpa-border">
              {testResult.steps.map((s) => (
                <div key={s.step} className="py-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {s.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-kalpa-success shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-kalpa-danger shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-kalpa-text">{s.step}</p>
                      <p className="font-mono text-[11px] text-kalpa-muted truncate">{s.detail}</p>
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-kalpa-muted shrink-0">
                    {s.ms} ms
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
