'use client';

import React, { useRef, useState } from 'react';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useUiStore } from '@/stores/ui';
import { Splitter } from '@/components/ui/Splitter';
import { Sheet } from '@/components/ui/Sheet';
import { ModelSwitcherSheet } from '@/components/home/ModelSwitcherSheet';
import { ChatPanel } from '@/components/agent/ChatPanel';
import { SandboxStatus } from '@/components/agent/SandboxStatus';
import { BrainPanel } from '@/components/agent/BrainPanel';
import { HistorySheet } from '@/components/agent/HistorySheet';
import { ExportSheet } from '@/components/agent/ExportSheet';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { FileTree } from './FileTree';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './CodeEditor';
import { PreviewPanel } from './PreviewPanel';
import { TerminalPanel } from './TerminalPanel';
import { DEFAULT_SPLITS, IdeSplitters, type SplitSizes } from './IdeSplitters';

const SPLIT_STORAGE_KEY = 'kalpa_ide_splits_v1';

export function IdeShell() {
  const { breakpoint } = useBreakpoint();
  const activeIdeTab = useUiStore((s) => s.activeIdeTab);
  const tabletRightMode = useUiStore((s) => s.tabletRightMode);
  const filesTreeCollapsed = useUiStore((s) => s.filesTreeCollapsed);
  const filesDrawerOpen = useUiStore((s) => s.filesDrawerOpen);
  const setFilesDrawerOpen = useUiStore((s) => s.setFilesDrawerOpen);
  const terminalCollapsed = useUiStore((s) => s.terminalCollapsed);
  const tabletTerminalOpen = useUiStore((s) => s.tabletTerminalOpen);
  const modelSheetOpen = useUiStore((s) => s.modelSheetOpen);
  const setModelSheetOpen = useUiStore((s) => s.setModelSheetOpen);

  const stageRef = useRef<HTMLElement>(null);
  const [splits, setSplits] = useState<SplitSizes>(() => {
    if (typeof window === 'undefined') return DEFAULT_SPLITS;
    try {
      const saved = localStorage.getItem(SPLIT_STORAGE_KEY);
      if (saved) return { ...DEFAULT_SPLITS, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
    return DEFAULT_SPLITS;
  });

  const updateSplits = (updater: (prev: SplitSizes) => SplitSizes) => {
    setSplits((prev) => {
      const next = updater(prev);
      try {
        localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const hiddenSlot =
    'invisible opacity-0 pointer-events-none z-0 overflow-hidden';
  const activeSlot =
    'visible opacity-100 pointer-events-auto z-10 overflow-hidden';

  let chatStyle: React.CSSProperties = { inset: 0 };
  let codeStyle: React.CSSProperties = { inset: 0 };
  let previewStyle: React.CSSProperties = { inset: 0 };
  let termStyle: React.CSSProperties = { inset: 0 };

  let chatVis = activeSlot;
  let codeVis = activeSlot;
  let previewVis = activeSlot;
  let termVis = activeSlot;

  if (breakpoint === 'desktop') {
    const rightPct = Math.max(18, 100 - splits.chatPct - splits.codePct);
    const termHeight = terminalCollapsed ? '36px' : `${splits.termPct}%`;
    const previewHeight = terminalCollapsed ? 'calc(100% - 36px)' : `${100 - splits.termPct}%`;

    chatStyle = { left: '0%', top: 0, bottom: 0, width: `${splits.chatPct}%` };
    codeStyle = {
      left: `${splits.chatPct}%`,
      top: 0,
      bottom: 0,
      width: `${splits.codePct}%`,
    };
    previewStyle = {
      left: `${splits.chatPct + splits.codePct}%`,
      top: 0,
      width: `${rightPct}%`,
      height: previewHeight,
    };
    termStyle = {
      left: `${splits.chatPct + splits.codePct}%`,
      bottom: 0,
      width: `${rightPct}%`,
      height: termHeight,
    };
  } else if (breakpoint === 'tablet') {
    const rightPct = 100 - splits.tabletChatPct;
    chatStyle = { left: '0%', top: 0, bottom: 0, width: `${splits.tabletChatPct}%` };
    codeStyle = { left: `${splits.tabletChatPct}%`, top: 0, bottom: 0, width: `${rightPct}%` };
    previewStyle = { left: `${splits.tabletChatPct}%`, top: 0, bottom: 0, width: `${rightPct}%` };
    termStyle = {
      left: `${splits.tabletChatPct}%`,
      right: 0,
      bottom: 0,
      height: `${splits.tabletTermPx}px`,
    };

    codeVis = tabletRightMode === 'code' ? activeSlot : hiddenSlot;
    previewVis = tabletRightMode === 'preview' ? activeSlot : hiddenSlot;
    termVis = tabletTerminalOpen
      ? 'visible opacity-100 pointer-events-auto z-30 shadow-kalpa-soft'
      : hiddenSlot;
  } else {
    chatVis = activeIdeTab === 'chat' ? activeSlot : hiddenSlot;
    codeVis = activeIdeTab === 'code' ? activeSlot : hiddenSlot;
    previewVis = activeIdeTab === 'preview' ? activeSlot : hiddenSlot;
    termVis = activeIdeTab === 'terminal' ? activeSlot : hiddenSlot;
  }

  return (
    <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-kalpa-bg">
      <TopBar onOpenModelSheet={() => setModelSheetOpen(true)} />
      <SandboxStatus />

      <main ref={stageRef} className="relative flex-1 min-h-0 w-full overflow-hidden">
        {/* Persistent Slot 1: Agent Chat */}
        <section
          aria-label="Chat panel"
          style={chatStyle}
          className={`absolute border-r border-kalpa-border ${chatVis}`}
        >
          <ChatPanel />
        </section>

        {/* Persistent Slot 2: Files + Code Editor */}
        <section
          aria-label="Code editor panel"
          style={codeStyle}
          className={`absolute flex flex-row border-r border-kalpa-border ${codeVis}`}
        >
          {breakpoint === 'desktop' && !filesTreeCollapsed ? (
            <div className="w-[220px] shrink-0 border-r border-kalpa-border h-full overflow-hidden">
              <FileTree />
            </div>
          ) : null}
          <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
            <EditorTabs />
            <div className="flex-1 min-h-0 overflow-hidden">
              <CodeEditor />
            </div>
          </div>
        </section>

        {/* Persistent Slot 3: Preview */}
        <section
          aria-label="Preview panel"
          style={previewStyle}
          className={`absolute ${previewVis}`}
        >
          <PreviewPanel />
        </section>

        {/* Persistent Slot 4: Terminal */}
        <section
          aria-label="Terminal panel"
          style={termStyle}
          className={`absolute border-t border-kalpa-border ${termVis}`}
        >
          {breakpoint === 'tablet' && tabletTerminalOpen ? (
            <Splitter
              orientation="horizontal"
              label="Resize terminal drawer"
              onDelta={(dy) =>
                updateSplits((s) => ({
                  ...s,
                  tabletTermPx: Math.max(160, Math.min(540, s.tabletTermPx - dy)),
                }))
              }
              onReset={() =>
                updateSplits((s) => ({ ...s, tabletTermPx: DEFAULT_SPLITS.tabletTermPx }))
              }
            />
          ) : null}
          <TerminalPanel />
        </section>

        <IdeSplitters
          breakpoint={breakpoint}
          splits={splits}
          terminalCollapsed={terminalCollapsed}
          stageRef={stageRef}
          updateSplits={updateSplits}
        />
      </main>

      {breakpoint === 'phone' ? <BottomNav /> : null}

      <Sheet
        open={breakpoint !== 'desktop' && filesDrawerOpen}
        onClose={() => setFilesDrawerOpen(false)}
        title="Project Files"
        side="left"
        className="p-0"
      >
        <div className="h-[calc(100dvh-60px)] -m-4">
          <FileTree onFileChosen={() => setFilesDrawerOpen(false)} />
        </div>
      </Sheet>

      <ModelSwitcherSheet
        open={modelSheetOpen}
        onClose={() => setModelSheetOpen(false)}
      />

      <BrainPanel />
      <HistorySheet />
      <ExportSheet />
    </div>
  );
}
