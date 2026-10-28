'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Brain,
  Cloud,
  Cpu,
  History,
  MoreHorizontal,
  Settings,
  Share,
  Terminal,
} from 'lucide-react';
import { useProviderStore } from '@/lib/providers/store';
import { useBrainStore } from '@/stores/brain';
import { useProjectStore } from '@/stores/project';
import { useSandboxStore } from '@/stores/sandbox';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Logo } from '@/components/brand/Logo';
import { EngineSwitch } from '@/components/agent/EngineSwitch';
import { IconButton } from '@/components/ui/IconButton';
import { Tabs } from '@/components/ui/Tabs';
import { ModelChip } from './ModelChip';

export interface TopBarProps {
  onOpenModelSheet: () => void;
}

export function TopBar({ onOpenModelSheet }: TopBarProps) {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);
  const renameProject = useProjectStore((s) => s.renameProject);

  const e2bApiKey = useProviderStore((s) => s.e2bApiKey);

  const setBrainOpen = useBrainStore((s) => s.setBrainOpen);
  const setHistoryOpen = useBrainStore((s) => s.setHistoryOpen);
  const setExportOpen = useBrainStore((s) => s.setExportOpen);

  const engine = useSandboxStore((s) => s.engine);
  const switchEngine = useSandboxStore((s) => s.switchEngine);

  const tabletRightMode = useUiStore((s) => s.tabletRightMode);
  const setTabletRightMode = useUiStore((s) => s.setTabletRightMode);
  const tabletTerminalOpen = useUiStore((s) => s.tabletTerminalOpen);
  const setTabletTerminalOpen = useUiStore((s) => s.setTabletTerminalOpen);
  const addToast = useUiStore((s) => s.addToast);

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [overflowOpen, setOverflowOpen] = useState(false);

  const commitName = async () => {
    setEditingName(false);
    if (currentProject && draftName.trim() && draftName.trim() !== currentProject.name) {
      await renameProject(currentProject.id, draftName.trim());
    }
  };

  const handlePhoneEngineToggle = async () => {
    setOverflowOpen(false);
    if (!currentProject) return;
    const next = engine === 'instant' ? 'cloud' : 'instant';
    if (next === 'cloud' && !e2bApiKey.trim()) {
      addToast({
        title: 'E2B API key required for Cloud Sandbox',
        description: 'Add your E2B key in Settings -> Engines.',
        kind: 'warn',
      });
      return;
    }
    const ok = await switchEngine(currentProject.id, next);
    if (ok) {
      addToast({
        title: next === 'cloud' ? 'Switched to Cloud Sandbox' : 'Switched to Instant Engine',
        kind: 'success',
      });
    }
  };

  return (
    <header className="h-13 border-b border-kalpa-border bg-kalpa-bg-2 px-2.5 sm:px-4 flex items-center justify-between gap-2 shrink-0 pt-safe z-30">
      <div className="flex items-center gap-2 min-w-0">
        <Link href="/" aria-label="Back to Kalpa Home" className="shrink-0">
          <Logo showWordmark={breakpoint === 'desktop'} size="sm" />
        </Link>

        <span className="text-kalpa-border select-none">/</span>

        {editingName ? (
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') setEditingName(false);
            }}
            autoFocus
            aria-label="Edit project name"
            className="min-h-[34px] px-2 rounded-[8px] bg-kalpa-surface border border-kalpa-violet text-sm font-medium text-kalpa-text w-36 sm:w-52 focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              if (!currentProject) return;
              setDraftName(currentProject.name);
              setEditingName(true);
            }}
            title="Click to rename project"
            className="min-h-[38px] px-2 rounded-[8px] hover:bg-kalpa-surface text-sm font-semibold text-kalpa-text truncate max-w-[145px] sm:max-w-[220px] cursor-pointer text-left"
          >
            {currentProject?.name ?? 'Loading…'}
          </button>
        )}
      </div>

      {breakpoint === 'tablet' ? (
        <div className="flex items-center gap-1.5">
          <Tabs
            tabs={[
              { id: 'preview', label: 'Preview' },
              { id: 'code', label: 'Code' },
            ]}
            value={tabletRightMode}
            onChange={setTabletRightMode}
          />
          <IconButton
            label="Toggle terminal drawer"
            size="sm"
            active={tabletTerminalOpen}
            onClick={() => setTabletTerminalOpen(!tabletTerminalOpen)}
          >
            <Terminal className="w-4 h-4" />
          </IconButton>
        </div>
      ) : null}

      {breakpoint === 'phone' ? (
        <div className="relative flex items-center gap-1 shrink-0">
          <ModelChip onClick={onOpenModelSheet} compact className="max-w-[138px]" />

          <IconButton
            label="Project Brain"
            size="sm"
            onClick={() => setBrainOpen(true)}
          >
            <Brain className="w-4 h-4 text-kalpa-violet" />
          </IconButton>

          <IconButton
            label="More workspace options"
            size="sm"
            onClick={() => setOverflowOpen((v) => !v)}
          >
            <MoreHorizontal className="w-4 h-4" />
          </IconButton>

          {overflowOpen ? (
            <div
              onMouseLeave={() => setOverflowOpen(false)}
              className="absolute right-0 top-full mt-1 z-50 w-60 rounded-[14px] bg-kalpa-bg-2 border border-kalpa-border shadow-kalpa-soft p-1.5 text-xs space-y-0.5"
            >
              <button
                type="button"
                onClick={handlePhoneEngineToggle}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-[8px] text-kalpa-text hover:bg-kalpa-surface cursor-pointer"
              >
                <span className="flex items-center gap-2 font-medium">
                  {engine === 'cloud' ? (
                    <Cloud className="w-3.5 h-3.5 text-kalpa-violet" />
                  ) : (
                    <Cpu className="w-3.5 h-3.5 text-kalpa-success" />
                  )}
                  Engine: {engine === 'cloud' ? 'Cloud Sandbox' : 'Instant'}
                </span>
                <span className="text-[11px] text-kalpa-violet">Switch</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setOverflowOpen(false);
                  setBrainOpen(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[8px] text-kalpa-text hover:bg-kalpa-surface cursor-pointer"
              >
                <Brain className="w-3.5 h-3.5 text-kalpa-violet" /> Project Brain
              </button>

              <button
                type="button"
                onClick={() => {
                  setOverflowOpen(false);
                  setHistoryOpen(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[8px] text-kalpa-text hover:bg-kalpa-surface cursor-pointer"
              >
                <History className="w-3.5 h-3.5" /> Checkpoints &amp; Undo
              </button>

              <button
                type="button"
                onClick={() => {
                  setOverflowOpen(false);
                  setExportOpen(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[8px] text-kalpa-text hover:bg-kalpa-surface cursor-pointer"
              >
                <Share className="w-3.5 h-3.5" /> Export ZIP / GitHub
              </button>

              <Link
                href="/diagnostics"
                onClick={() => setOverflowOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[8px] text-kalpa-text hover:bg-kalpa-surface"
              >
                <Activity className="w-3.5 h-3.5" /> Diagnostics
              </Link>
              <Link
                href="/settings"
                onClick={() => setOverflowOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[8px] text-kalpa-text hover:bg-kalpa-surface"
              >
                <Settings className="w-3.5 h-3.5" /> Settings
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 shrink-0">
          <EngineSwitch />

          <ModelChip onClick={onOpenModelSheet} className="max-w-[260px]" />

          <IconButton
            label="Project Brain (.kalpa)"
            size="sm"
            onClick={() => setBrainOpen(true)}
          >
            <Brain className="w-4 h-4 text-kalpa-violet" />
          </IconButton>

          <IconButton
            label="Checkpoints & History"
            size="sm"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="w-4 h-4" />
          </IconButton>

          <IconButton
            label="Export ZIP or Push to GitHub"
            size="sm"
            onClick={() => setExportOpen(true)}
          >
            <Share className="w-4 h-4" />
          </IconButton>

          <Link
            href="/settings"
            aria-label="Open Settings"
            title="Settings"
            className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-[10px] text-kalpa-muted hover:text-kalpa-text hover:bg-kalpa-surface transition-colors"
          >
            <Settings className="w-4 h-4" />
          </Link>
        </div>
      )}
    </header>
  );
}
