'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Settings } from 'lucide-react';
import { TAGLINE } from '@/lib/brand';
import type { EngineKind, StackKind } from '@/lib/vfs/db';
import { useProviderStore } from '@/lib/providers/store';
import { useProjectStore } from '@/stores/project';
import { Logo } from '@/components/brand/Logo';
import { AuroraBackground } from '@/components/brand/AuroraBackground';
import { PromptBox } from '@/components/home/PromptBox';
import { KeySetupCard } from '@/components/home/KeySetupCard';
import { RecentProjects } from '@/components/home/RecentProjects';
import { ModelSwitcherSheet } from '@/components/home/ModelSwitcherSheet';
import { Sheet } from '@/components/ui/Sheet';

export default function HomePage() {
  const router = useRouter();
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const createProject = useProjectStore((s) => s.createProject);
  const initialized = useProviderStore((s) => s.initialized);
  const profiles = useProviderStore((s) => s.profiles);
  const getActiveProfile = useProviderStore((s) => s.getActiveProfile);

  const [running, setRunning] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [keyRequiredSheet, setKeyRequiredSheet] = useState(false);
  const [pendingRun, setPendingRun] = useState<{
    prompt: string;
    stack: StackKind;
    engine: EngineKind;
  } | null>(null);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const executeProjectLaunch = async (prompt: string, stack: StackKind, engine: EngineKind) => {
    setRunning(true);
    try {
      const proj = await createProject({ stack, engine, initialPrompt: prompt });
      router.push(`/ide?p=${encodeURIComponent(proj.id)}&run=1`);
    } finally {
      setRunning(false);
    }
  };

  const handleRun = async (prompt: string, stack: StackKind, engine: EngineKind) => {
    const active = getActiveProfile();
    const isLocal = active && /localhost|127\.0\.0\.1/.test(active.baseUrl);
    if (!active || (!active.apiKey && !isLocal)) {
      setPendingRun({ prompt, stack, engine });
      setKeyRequiredSheet(true);
      return;
    }
    await executeProjectLaunch(prompt, stack, engine);
  };

  const hasAnyProvider = profiles.some(
    (p) => Boolean(p.apiKey) || /localhost|127\.0\.0\.1/.test(p.baseUrl)
  );

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <AuroraBackground />

      <header className="w-full pt-safe">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-15 flex items-center justify-between gap-8">
          <Link href="/" aria-label="Kalpa home" className="shrink-0">
            <Logo size="md" />
          </Link>

          <nav className="hidden sm:flex items-center gap-6 text-sm text-kalpa-muted">
            <Link
              href="/settings"
              className="hover:text-kalpa-text transition-colors whitespace-nowrap shrink-0"
            >
              Providers
            </Link>
            <Link
              href="/diagnostics"
              className="hover:text-kalpa-text transition-colors whitespace-nowrap shrink-0"
            >
              Diagnostics
            </Link>
          </nav>

          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-[10px] bg-kalpa-surface hover:bg-kalpa-surface-2 border border-kalpa-border text-xs font-medium text-kalpa-text whitespace-nowrap shrink-0 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-14 flex flex-col items-center gap-10">
        <div className="text-center space-y-2.5 max-w-2xl">
          <h1
            className="text-3xl sm:text-5xl font-bold tracking-tight text-kalpa-text leading-[1.12]"
            style={{ textWrap: 'balance' }}
          >
            What do you want to build?
          </h1>
          <p className="text-sm sm:text-base text-kalpa-muted">{TAGLINE}</p>
        </div>

        <div className="w-full max-w-3xl">
          <PromptBox
            onRun={handleRun}
            onOpenModelSheet={() => setModelSheetOpen(true)}
            running={running}
          />
        </div>

        {initialized && !hasAnyProvider ? (
          <div className="w-full max-w-3xl">
            <KeySetupCard />
          </div>
        ) : null}

        <div className="w-full pt-2">
          <RecentProjects />
        </div>
      </main>

      <footer className="w-full border-t border-kalpa-border/60 py-5 pb-safe mt-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3 text-xs text-kalpa-muted">
          <p>Your keys never leave your browser.</p>
          <div className="flex items-center gap-5">
            <Link href="/diagnostics" className="hover:text-kalpa-text transition-colors">
              Diagnostics
            </Link>
            <Link href="/settings" className="hover:text-kalpa-text transition-colors">
              Settings
            </Link>
          </div>
        </div>
      </footer>

      <ModelSwitcherSheet open={modelSheetOpen} onClose={() => setModelSheetOpen(false)} />

      <Sheet
        open={keyRequiredSheet}
        onClose={() => {
          setKeyRequiredSheet(false);
          setPendingRun(null);
        }}
        title="Connect an AI Provider Key to Continue"
        side="bottom"
      >
        <div className="max-w-xl mx-auto">
          <KeySetupCard
            compact
            onSaved={() => {
              setKeyRequiredSheet(false);
              if (pendingRun) {
                const { prompt, stack, engine } = pendingRun;
                setPendingRun(null);
                executeProjectLaunch(prompt, stack, engine);
              }
            }}
          />
        </div>
      </Sheet>
    </div>
  );
}
