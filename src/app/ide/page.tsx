'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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

function IdeRouteInner() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('p');
  const shouldAutoRun = searchParams.get('run') === '1';

  const openWorkspace = useProjectStore((s) => s.openWorkspace);
  const loadChat = useChatStore((s) => s.loadChat);
  const runInitialProjectTurn = useChatStore((s) => s.runInitialProjectTurn);
  const loadBrain = useBrainStore((s) => s.loadBrain);
  const hydratePrefs = useAgentStore((s) => s.hydratePrefs);
  const syncEngineFromProject = useSandboxStore((s) => s.syncEngineFromProject);
  const initProviders = useProviderStore((s) => s.initProviders);

  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const ranInitialRef = useRef<string | null>(null);

  useEffect(() => {
    hydratePrefs();
  }, [hydratePrefs]);

  useEffect(() => {
    if (!projectId) {
      setStatus('missing');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    (async () => {
      await initProviders();
      const [found, history] = await Promise.all([
        openWorkspace(projectId),
        loadChat(projectId),
        loadBrain(projectId),
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

      if (
        shouldAutoRun &&
        ranInitialRef.current !== projectId &&
        history.length > 0 &&
        history[history.length - 1].role === 'user'
      ) {
        ranInitialRef.current = projectId;
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', `/ide?p=${encodeURIComponent(projectId)}`);
        }
        const initialPrompt = history[history.length - 1].content;
        void runInitialProjectTurn(projectId, initialPrompt);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    shouldAutoRun,
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
