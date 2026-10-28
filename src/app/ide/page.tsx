'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { deleteSetting, getSetting, type EngineKind, type StackKind } from '@/lib/vfs/db';
import { useProjectStore } from '@/stores/project';
import { useChatStore } from '@/stores/chat';
import { useBrainStore } from '@/stores/brain';
import { useAgentStore } from '@/stores/agent';
import { useSandboxStore } from '@/stores/sandbox';
import { useProviderStore } from '@/lib/providers/store';
import { IdeShell } from '@/components/ide/IdeShell';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';

export const dynamic = 'force-dynamic';

export interface PendingRunRecord {
  projectId: string;
  prompt: string;
  stack: StackKind;
  engine: EngineKind;
  createdAt: number;
}

const startedPendingRuns = new Set<string>();

function IdeRouteInner() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('p');

  const openWorkspace = useProjectStore((s) => s.openWorkspace);
  const loadChat = useChatStore((s) => s.loadChat);
  const runInitialProjectTurn = useChatStore((s) => s.runInitialProjectTurn);
  const loadBrain = useBrainStore((s) => s.loadBrain);
  const hydratePrefs = useAgentStore((s) => s.hydratePrefs);
  const syncEngineFromProject = useSandboxStore((s) => s.syncEngineFromProject);
  const initProviders = useProviderStore((s) => s.initProviders);

  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    hydratePrefs();
  }, [hydratePrefs]);

  useEffect(() => {
    if (!projectId) {
      setStatus('missing');
      return;
    }

    let cancelled = false;
    if (useProjectStore.getState().currentProject?.id !== projectId) {
      setStatus('loading');
    }

    (async () => {
      await initProviders();
      const pendingKey = `pendingRun:${projectId}`;
      const [found, history, , pending] = await Promise.all([
        openWorkspace(projectId),
        loadChat(projectId),
        loadBrain(projectId),
        getSetting<PendingRunRecord>(pendingKey),
      ]);
      if (cancelled) return;
      if (!found) {
        setStatus('missing');
        return;
      }

      const proj = useProjectStore.getState().currentProject;
      if (proj) {
        syncEngineFromProject(proj.id, proj.engine);
      }

      setStatus('ready');

      const urlHasRun =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('run') === '1';
      const lastMsg = history[history.length - 1];
      const promptToRun =
        pending?.prompt ||
        (urlHasRun && lastMsg?.role === 'user' ? lastMsg.content : null);

      if (promptToRun && !startedPendingRuns.has(projectId)) {
        startedPendingRuns.add(projectId);
        await deleteSetting(pendingKey);
        if (typeof window !== 'undefined' && urlHasRun) {
          window.history.replaceState(null, '', `/ide?p=${encodeURIComponent(projectId)}`);
        }
        const hasPersistedUserMsg = history.some(
          (m) => m.role === 'user' && m.content.trim() === promptToRun.trim()
        );
        void runInitialProjectTurn(projectId, promptToRun, hasPersistedUserMsg);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    initProviders,
    openWorkspace,
    loadChat,
    loadBrain,
    syncEngineFromProject,
    runInitialProjectTurn,
  ]);

  if (status === 'loading') {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center gap-3 bg-kalpa-bg text-kalpa-muted">
        <Spinner size={24} className="text-kalpa-violet" />
        <p className="text-xs font-mono">Loading project workspace…</p>
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center p-6 text-center bg-kalpa-bg gap-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-kalpa-text">Project not found</h1>
          <p className="text-sm text-kalpa-muted">
            This project does not exist in local browser storage or was deleted.
          </p>
        </div>
        <Link href="/">
          <Button variant="primary">Back to Home</Button>
        </Link>
      </div>
    );
  }

  return <IdeShell />;
}

export default function IdePage() {
  return (
    <Suspense
      fallback={
        <div className="h-[100dvh] flex items-center justify-center bg-kalpa-bg">
          <Spinner size={24} className="text-kalpa-violet" />
        </div>
      }
    >
      <IdeRouteInner />
    </Suspense>
  );
}
