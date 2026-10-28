'use client';

import React, { useState } from 'react';
import { AlertTriangle, Clock, RefreshCw, Save } from 'lucide-react';
import { createCheckpoint } from '@/lib/checkpoints/checkpoints';
import { useProjectStore } from '@/stores/project';
import { useSandboxStore } from '@/stores/sandbox';
import { useUiStore } from '@/stores/ui';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

function formatCountdown(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function SandboxStatus() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const engine = useSandboxStore((s) => s.engine);
  const status = useSandboxStore((s) => s.status);
  const remainingMs = useSandboxStore((s) => s.remainingMs);
  const errorMessage = useSandboxStore((s) => s.errorMessage);
  const extendCloud = useSandboxStore((s) => s.extendCloud);
  const recreateCloud = useSandboxStore((s) => s.recreateCloud);
  const switchEngine = useSandboxStore((s) => s.switchEngine);
  const addToast = useUiStore((s) => s.addToast);

  const [busy, setBusy] = useState(false);

  if (engine !== 'cloud') return null;

  if (status === 'connecting') {
    return (
      <div className="px-3 py-1.5 bg-kalpa-violet/15 border-b border-kalpa-violet/30 flex items-center gap-2 text-xs text-kalpa-text shrink-0">
        <Spinner size={13} className="text-kalpa-violet shrink-0" />
        <span>Booting Cloud Sandbox (Ubuntu Linux) &amp; syncing VFS files…</span>
      </div>
    );
  }

  if (status === 'connected' && remainingMs > 0 && remainingMs <= FIVE_MINUTES_MS) {
    return (
      <div className="px-3 py-1.5 bg-kalpa-warn/15 border-b border-kalpa-warn/35 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex items-center gap-2 text-kalpa-warn">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>
            Cloud Sandbox expires in <strong className="font-mono">{formatCountdown(remainingMs)}</strong> (VFS files are safe locally).
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            leftIcon={<Save className="w-3 h-3" />}
            onClick={async () => {
              if (!currentProject) return;
              setBusy(true);
              await createCheckpoint(currentProject.id, 'Saved before sandbox expiry');
              setBusy(false);
              addToast({ title: 'Checkpoint saved in local IndexedDB', kind: 'success' });
            }}
          >
            Save Checkpoint
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await extendCloud(15 * 60 * 1000);
              setBusy(false);
              addToast({ title: 'Extended Cloud Sandbox by 15 minutes', kind: 'success' });
            }}
          >
            Extend +15m
          </Button>
        </div>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="px-3 py-1.5 bg-kalpa-warn/15 border-b border-kalpa-warn/35 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex items-center gap-2 text-kalpa-text">
          <AlertTriangle className="w-3.5 h-3.5 text-kalpa-warn shrink-0" />
          <span>Cloud Sandbox session expired. Your files are intact in local storage.</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => currentProject && switchEngine(currentProject.id, 'instant')}
          >
            Use Instant
          </Button>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<RefreshCw className="w-3 h-3" />}
            onClick={() => currentProject && recreateCloud(currentProject.id)}
          >
            Recreate Sandbox
          </Button>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="px-3 py-1.5 bg-kalpa-danger/15 border-b border-kalpa-danger/35 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex items-center gap-2 text-kalpa-danger min-w-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{errorMessage || 'Cloud Sandbox connection failed.'}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => currentProject && switchEngine(currentProject.id, 'instant')}
          >
            Switch to Instant
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => currentProject && recreateCloud(currentProject.id)}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
