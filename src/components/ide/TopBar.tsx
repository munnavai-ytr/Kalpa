'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Check,
  Cpu,
  Download,
  KeyRound,
  MoreHorizontal,
  Settings,
  Terminal,
} from 'lucide-react';
import { downloadProjectZip } from '@/lib/vfs/zip';
import { useProviderStore } from '@/lib/providers/store';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Logo } from '@/components/brand/Logo';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { Tabs } from '@/components/ui/Tabs';

export interface TopBarProps {
  onOpenModelSheet: () => void;
}

export function TopBar({ onOpenModelSheet }: TopBarProps) {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);
  const renameProject = useProjectStore((s) => s.renameProject);

  const profiles = useProviderStore((s) => s.profiles);
  const activeProfileId = useProviderStore((s) => s.activeProfileId);
  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;

  const tabletRightMode = useUiStore((s) => s.tabletRightMode);
  const setTabletRightMode = useUiStore((s) => s.setTabletRightMode);
  const tabletTerminalOpen = useUiStore((s) => s.tabletTerminalOpen);
  const setTabletTerminalOpen = useUiStore((s) => s.setTabletTerminalOpen);
  const addToast = useUiStore((s) => s.addToast);

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [enginePopover, setEnginePopover] = useState(false);

  const commitName = async () => {
    setEditingName(false);
    if (currentProject && draftName.trim() && draftName.trim() !== currentProject.name) {
      await renameProject(currentProject.id, draftName.trim());
    }
  };

  return (
    <header className="h-13 border-b border-kalpa-border bg-kalpa-bg-2 px-2.5 sm:px-4 flex items-center justify-between gap-2 shrink-0 pt-safe z-30">
      {/* Left: Brand + Editable Project Name */}
      <div className="flex items-center gap-2.5 min-w-0">
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
            className="min-h-[34px] px-2 rounded-[8px] bg-kalpa-surface border border-kalpa-violet text-sm font-medium text-kalpa-text w-40 sm:w-56 focus:outline-none"
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
            className="min-h-[38px] px-2 rounded-[8px] hover:bg-kalpa-surface text-sm font-semibold text-kalpa-text truncate max-w-[165px] sm:max-w-[240px] cursor-pointer text-left"
          >
            {currentProject?.name ?? 'Loading…'}
          </button>
        )}
      </div>

      {/* Center (Tablet only): Segmented Preview | Code switch */}
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

      {/* Right: Engine, Model, Settings (collapsed into overflow menu on phone) */}
      {breakpoint === 'phone' ? (
        <div className="relative flex items-center gap-1 shrink-0">
          <Chip
            onClick={onOpenModelSheet}
            active={Boolean(activeProfile)}
            icon={<KeyRound className="w-3 h-3" />}
            className="max-w-[120px]"
          >
            <span className="truncate">
              {activeProfile ? activeProfile.model : 'Add key'}
            </span>
          </Chip>

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
              className="absolute right-0 top-full mt-1 z-50 w-56 rounded-[14px] bg-kalpa-bg-2 border border-kalpa-border shadow-kalpa-soft p-1.5 text-xs space-y-0.5"
            >
              <div className="px-3 py-2 text-kalpa-muted border-b border-kalpa-border">
                <p className="font-semibold text-kalpa-text">Engine: Instant</p>
                <p className="text-[11px] mt-0.5">Cloud Sandbox: Coming in Prompt 2</p>
              </div>
              {currentProject ? (
                <button
                  type="button"
                  onClick={() => {
                    setOverflowOpen(false);
                    downloadProjectZip(currentProject.id, currentProject.name);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[8px] text-kalpa-text hover:bg-kalpa-surface cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Export project ZIP
                </button>
              ) : null}
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
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Chip
              active
              icon={<Cpu className="w-3.5 h-3.5 text-kalpa-success" />}
              onClick={() => setEnginePopover((v) => !v)}
            >
              Instant
            </Chip>
            {enginePopover ? (
              <div
                onMouseLeave={() => setEnginePopover(false)}
                className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded-[14px] bg-kalpa-bg-2 border border-kalpa-border shadow-kalpa-soft p-2 text-xs space-y-1"
              >
                <button
                  type="button"
                  onClick={() => setEnginePopover(false)}
                  className="w-full flex items-center justify-between p-2.5 rounded-[10px] bg-kalpa-violet/15 text-kalpa-text cursor-pointer"
                >
                  <div>
                    <p className="font-semibold">Instant Engine</p>
                    <p className="text-[11px] text-kalpa-muted">100% browser runtime</p>
                  </div>
                  <Check className="w-4 h-4 text-kalpa-violet" />
                </button>
                <button
                  type="button"
                  disabled
                  onClick={() =>
                    addToast({ title: 'Cloud Sandbox arrives in Prompt 2', kind: 'info' })
                  }
                  className="w-full flex items-center justify-between p-2.5 rounded-[10px] opacity-55 text-left cursor-not-allowed"
                >
                  <div>
                    <p className="font-semibold text-kalpa-text">Cloud Sandbox</p>
                    <p className="text-[11px] text-kalpa-muted">Prompt 2 (real Linux microVM)</p>
                  </div>
                </button>
              </div>
            ) : null}
          </div>

          <Chip
            onClick={onOpenModelSheet}
            active={Boolean(activeProfile)}
            icon={<KeyRound className="w-3.5 h-3.5" />}
            className="max-w-[200px]"
          >
            <span className="truncate">
              {activeProfile
                ? `${activeProfile.label} · ${activeProfile.model}`
                : 'Add key'}
            </span>
          </Chip>

          {currentProject ? (
            <IconButton
              label="Export project ZIP"
              size="sm"
              onClick={() => downloadProjectZip(currentProject.id, currentProject.name)}
            >
              <Download className="w-4 h-4" />
            </IconButton>
          ) : null}

          <Link
            href="/settings"
            aria-label="Open Settings"
            title="Settings"
            className="inline-flex items-center justify-center min-h-[38px] min-w-[38px] rounded-[10px] text-kalpa-muted hover:text-kalpa-text hover:bg-kalpa-surface transition-colors"
          >
            <Settings className="w-4 h-4" />
          </Link>
        </div>
      )}
    </header>
  );
}
