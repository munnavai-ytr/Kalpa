'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Check, Cloud, Cpu, Settings } from 'lucide-react';
import { useProviderStore } from '@/lib/providers/store';
import { useProjectStore } from '@/stores/project';
import { useSandboxStore } from '@/stores/sandbox';
import { useUiStore } from '@/stores/ui';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';

function formatShortTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function EngineSwitch() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const e2bApiKey = useProviderStore((s) => s.e2bApiKey);
  const engine = useSandboxStore((s) => s.engine);
  const status = useSandboxStore((s) => s.status);
  const remainingMs = useSandboxStore((s) => s.remainingMs);
  const switchEngine = useSandboxStore((s) => s.switchEngine);
  const addToast = useUiStore((s) => s.addToast);

  const [open, setOpen] = useState(false);

  const handleSelect = async (target: 'instant' | 'cloud') => {
    setOpen(false);
    if (!currentProject || target === engine) return;
    if (target === 'cloud' && !e2bApiKey.trim()) {
      addToast({
        title: 'E2B API key required for Cloud Sandbox',
        description: 'Add your E2B key in Settings -> Engines.',
        kind: 'warn',
      });
      return;
    }
    const ok = await switchEngine(currentProject.id, target);
    if (ok) {
      addToast({
        title: target === 'cloud' ? 'Switched to Cloud Sandbox' : 'Switched to Instant Engine',
        kind: 'success',
      });
    }
  };

  return (
    <div className="relative">
      <Chip
        active
        onClick={() => setOpen((v) => !v)}
        icon={
          engine === 'cloud' ? (
            status === 'connecting' ? (
              <Spinner size={12} className="text-kalpa-violet" />
            ) : (
              <Cloud
                className={`w-3.5 h-3.5 ${
                  status === 'connected' ? 'text-kalpa-success' : 'text-kalpa-warn'
                }`}
              />
            )
          ) : (
            <Cpu className="w-3.5 h-3.5 text-kalpa-success" />
          )
        }
      >
        {engine === 'cloud'
          ? status === 'connected'
            ? `Cloud · ${formatShortTime(remainingMs)}`
            : status === 'connecting'
              ? 'Cloud…'
              : 'Cloud'
          : 'Instant'}
      </Chip>

      {open ? (
        <div
          onMouseLeave={() => setOpen(false)}
          className="absolute right-0 top-full mt-1.5 z-50 w-68 rounded-[14px] bg-kalpa-bg-2 border border-kalpa-border shadow-kalpa-soft p-2 text-xs space-y-1"
        >
          <button
            type="button"
            onClick={() => handleSelect('instant')}
            className={`w-full flex items-center justify-between p-2.5 rounded-[10px] text-left cursor-pointer ${
              engine === 'instant' ? 'bg-kalpa-violet/15 text-kalpa-text' : 'hover:bg-kalpa-surface text-kalpa-text'
            }`}
          >
            <div>
              <p className="font-semibold">Instant Engine</p>
              <p className="text-[11px] text-kalpa-muted">100% browser runtime (Sandpack / Pyodide)</p>
            </div>
            {engine === 'instant' ? <Check className="w-4 h-4 text-kalpa-violet shrink-0" /> : null}
          </button>

          <button
            type="button"
            onClick={() => handleSelect('cloud')}
            className={`w-full flex items-center justify-between p-2.5 rounded-[10px] text-left cursor-pointer ${
              engine === 'cloud' ? 'bg-kalpa-violet/15 text-kalpa-text' : 'hover:bg-kalpa-surface text-kalpa-text'
            }`}
          >
            <div>
              <p className="font-semibold">Cloud Sandbox (E2B)</p>
              <p className="text-[11px] text-kalpa-muted">
                {e2bApiKey.trim()
                  ? 'Ubuntu Linux VM, npm, git, full Next.js'
                  : 'Requires E2B key in Settings'}
              </p>
            </div>
            {engine === 'cloud' ? <Check className="w-4 h-4 text-kalpa-violet shrink-0" /> : null}
          </button>

          {!e2bApiKey.trim() ? (
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-[8px] text-[11px] text-kalpa-violet hover:bg-kalpa-surface"
            >
              <Settings className="w-3.5 h-3.5" />
              Configure E2B key in Settings →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
