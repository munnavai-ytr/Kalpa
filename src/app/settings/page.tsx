'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Activity } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { AuroraBackground } from '@/components/brand/AuroraBackground';
import { Tabs, type TabOption } from '@/components/ui/Tabs';
import { ProvidersTab } from '@/components/settings/ProvidersTab';
import { AgentTab } from '@/components/settings/AgentTab';
import { EnginesTab } from '@/components/settings/EnginesTab';
import { ExportTab } from '@/components/settings/ExportTab';
import { AppearanceTab } from '@/components/settings/AppearanceTab';
import { DataTab } from '@/components/settings/DataTab';
import { PrivacyTab } from '@/components/settings/PrivacyTab';

type SettingsSection =
  | 'providers'
  | 'agent'
  | 'engines'
  | 'export'
  | 'appearance'
  | 'data'
  | 'privacy';

const TABS: TabOption<SettingsSection>[] = [
  { id: 'providers', label: 'AI Providers' },
  { id: 'agent', label: 'Agent' },
  { id: 'engines', label: 'Engines' },
  { id: 'export', label: 'Export' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'data', label: 'Data' },
  { id: 'privacy', label: 'Privacy' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsSection>('providers');

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <AuroraBackground />
      <header className="sticky top-0 z-30 kalpa-glass border-b border-kalpa-border pt-safe">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-kalpa-muted hover:text-kalpa-text min-h-[44px] pr-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </Link>
            <Logo size="sm" />
          </div>
          <Link
            href="/diagnostics"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-kalpa-muted hover:text-kalpa-text min-h-[44px] px-2 whitespace-nowrap shrink-0"
          >
            <Activity className="w-4 h-4 text-kalpa-violet" />
            Diagnostics
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 pb-safe">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-kalpa-text">
            Settings
          </h1>
          <p className="text-sm text-kalpa-muted">
            Configure BYOK model providers, agent behavior, execution engines, GitHub export, and browser storage.
          </p>
        </div>

        <div className="overflow-x-auto pb-1">
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
        </div>

        <div>
          {tab === 'providers' ? <ProvidersTab /> : null}
          {tab === 'agent' ? <AgentTab /> : null}
          {tab === 'engines' ? <EnginesTab /> : null}
          {tab === 'export' ? <ExportTab /> : null}
          {tab === 'appearance' ? <AppearanceTab /> : null}
          {tab === 'data' ? <DataTab /> : null}
          {tab === 'privacy' ? <PrivacyTab /> : null}
        </div>
      </main>
    </div>
  );
}
