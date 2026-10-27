'use client';

import React, { useState } from 'react';
import { Cloud, Cpu, Eye, EyeOff } from 'lucide-react';
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await setE2bApiKey(draftKey.trim());
    addToast({ title: 'Cloud Sandbox key updated', kind: 'success' });
  };

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <div className="flex items-center gap-2.5">
          <Cpu className="w-4 h-4 text-kalpa-success shrink-0" />
          <h3 className="text-sm font-semibold text-kalpa-text">Engine A: Instant (Active)</h3>
        </div>
        <p className="text-sm text-kalpa-muted leading-relaxed">
          Runs 100% inside your browser with zero server setup or sandbox fees. Instant supports
          static HTML/CSS/JS sites, client-side React/Vue/Svelte/Solid apps via Sandpack, Next.js
          App Router client routes via Next-Lite, Python 3 via Pyodide WebAssembly, and JavaScript
          worker scripts.
        </p>
        <div className="pt-1 text-xs text-kalpa-muted space-y-1">
          <p className="font-medium text-kalpa-text">Plain-language limits of Instant:</p>
          <p>· Server-only Next.js features (API routes, Server Actions, async Server Components) require a real Linux server.</p>
          <p>· Terminal commands like npm, git, docker, or native C/Rust compilers cannot run in browser WebAssembly.</p>
          <p>· Python micropip installs pure-Python wheels only.</p>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Cloud className="w-4 h-4 text-kalpa-violet shrink-0" />
            <h3 className="text-sm font-semibold text-kalpa-text">
              Cloud Sandbox (E2B) · Coming in the next step
            </h3>
          </div>
        </div>
        <p className="text-sm text-kalpa-muted leading-relaxed">
          Real Linux microVMs for full Next.js servers, npm/git/docker, and real PTY terminals will
          plug in during Prompt 2. You can pre-save your E2B API key in the same local browser vault now.
        </p>
        <form onSubmit={handleSave} className="space-y-3">
          <label className="block text-xs font-medium text-kalpa-muted">
            Cloud Sandbox key (E2B) - used in the next step
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
              Save E2B Key
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
