'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useUiStore } from '@/stores/ui';
import { Splitter } from '@/components/ui/Splitter';
import { Sheet } from '@/components/ui/Sheet';
import { ModelSwitcherSheet } from '@/components/home/ModelSwitcherSheet';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { ChatPanel } from './ChatPanel';
import { FileTree } from './FileTree';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './CodeEditor';
import { PreviewPanel } from './PreviewPanel';
import { TerminalPanel } from './TerminalPanel';

const SPLIT_STORAGE_KEY = 'kalpa_ide_splits_v1';

interface SplitSizes {
  chatPct: number; // desktop default 28
  codePct: number; // desktop default 38 (preview = 100 - chat - code = 34)
  termPct: number; // desktop default 32
  tabletChatPct: number; // tablet default 38
  tabletTermPx: number; // tablet bottom drawer height default 260
}

const DEFAULT_SPLITS: SplitSizes = {
  chatPct: 28,
  codePct: 38,
  termPct: 32,
  tabletChatPct: 38,
  tabletTermPx: 260,
};

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

  // Compute exact slot styles for the 4 persistent panels so NONE ever unmount across tab/breakpoint changes!
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
    termVis = tabletTerminalOpen ? 'visible opacity-100 pointer-events-auto z-30 shadow-kalpa-soft' : hiddenSlot;
  } else {
    // Phone (< 700px): full-screen single active panel
    chatVis = activeIdeTab === 'chat' ? activeSlot : hiddenSlot;
    codeVis = activeIdeTab === 'code' ? activeSlot : hiddenSlot;
    previewVis = activeIdeTab === 'preview' ? activeSlot : hiddenSlot;
    termVis = activeIdeTab === 'terminal' ? activeSlot : hiddenSlot;
  }

  return (
    <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-kalpa-bg">
      <TopBar onOpenModelSheet={() => setModelSheetOpen(true)} />

      <main ref={stageRef} className="relative flex-1 min-h-0 w-full overflow-hidden">
        {/* Persistent Slot 1: Chat */}
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
              onReset={() => updateSplits((s) => ({ ...s, tabletTermPx: DEFAULT_SPLITS.tabletTermPx }))}
            />
          ) : null}
          <TerminalPanel />
        </section>

        {/* Desktop Splitters */}
        {breakpoint === 'desktop' ? (
          <>
            <div
              style={{ left: `${splits.chatPct}%`, top: 0, bottom: 0 }}
              className="absolute z-20"
            >
              <Splitter
                orientation="vertical"
                label="Resize Chat and Code columns"
                onDelta={(dx) => {
                  const totalW = stageRef.current?.clientWidth || 1200;
                  const dPct = (dx / totalW) * 100;
                  updateSplits((s) => {
                    const nextChat = Math.max(18, Math.min(48, s.chatPct + dPct));
                    const diff = nextChat - s.chatPct;
                    const nextCode = Math.max(22, Math.min(58, s.codePct - diff));
                    return { ...s, chatPct: nextChat, codePct: nextCode };
                  });
                }}
                onReset={() =>
                  updateSplits((s) => ({
                    ...s,
                    chatPct: DEFAULT_SPLITS.chatPct,
                    codePct: DEFAULT_SPLITS.codePct,
                  }))
                }
              />
            </div>

            <div
              style={{ left: `${splits.chatPct + splits.codePct}%`, top: 0, bottom: 0 }}
              className="absolute z-20"
            >
              <Splitter
                orientation="vertical"
                label="Resize Code and Preview columns"
                onDelta={(dx) => {
                  const totalW = stageRef.current?.clientWidth || 1200;
                  const dPct = (dx / totalW) * 100;
                  updateSplits((s) => {
                    const maxCode = 100 - s.chatPct - 20;
                    const nextCode = Math.max(20, Math.min(maxCode, s.codePct + dPct));
                    return { ...s, codePct: nextCode };
                  });
                }}
                onReset={() =>
                  updateSplits((s) => ({
                    ...s,
                    chatPct: DEFAULT_SPLITS.chatPct,
                    codePct: DEFAULT_SPLITS.codePct,
                  }))
                }
              />
            </div>

            {!terminalCollapsed ? (
              <div
                style={{
                  left: `${splits.chatPct + splits.codePct}%`,
                  right: 0,
                  bottom: `${splits.termPct}%`,
                }}
                className="absolute z-20"
              >
                <Splitter
                  orientation="horizontal"
                  label="Resize Preview and Terminal height"
                  onDelta={(dy) => {
                    const totalH = stageRef.current?.clientHeight || 800;
                    const dPct = (dy / totalH) * 100;
                    updateSplits((s) => ({
                      ...s,
                      termPct: Math.max(16, Math.min(72, s.termPct - dPct)),
                    }));
                  }}
                  onReset={() =>
                    updateSplits((s) => ({ ...s, termPct: DEFAULT_SPLITS.termPct }))
                  }
                />
              </div>
            ) : null}
          </>
        ) : null}

        {/* Tablet Column Splitter */}
        {breakpoint === 'tablet' ? (
          <div
            style={{ left: `${splits.tabletChatPct}%`, top: 0, bottom: 0 }}
            className="absolute z-20"
          >
            <Splitter
              orientation="vertical"
              label="Resize Chat and Workspace columns"
              onDelta={(dx) => {
                const totalW = stageRef.current?.clientWidth || 900;
                const dPct = (dx / totalW) * 100;
                updateSplits((s) => ({
                  ...s,
                  tabletChatPct: Math.max(26, Math.min(55, s.tabletChatPct + dPct)),
                }));
              }}
              onReset={() =>
                updateSplits((s) => ({ ...s, tabletChatPct: DEFAULT_SPLITS.tabletChatPct }))
              }
            />
          </div>
        ) : null}
      </main>

      {breakpoint === 'phone' ? <BottomNav /> : null}

      {/* Phone & Tablet Left Slide-in FileTree Drawer */}
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
    </div>
  );
}
