'use client';

import React from 'react';
import { Splitter } from '@/components/ui/Splitter';

export interface SplitSizes {
  chatPct: number;
  codePct: number;
  termPct: number;
  tabletChatPct: number;
  tabletTermPx: number;
}

export const DEFAULT_SPLITS: SplitSizes = {
  chatPct: 28,
  codePct: 38,
  termPct: 32,
  tabletChatPct: 38,
  tabletTermPx: 260,
};

export interface IdeSplittersProps {
  breakpoint: 'phone' | 'tablet' | 'desktop';
  splits: SplitSizes;
  terminalCollapsed: boolean;
  stageRef: React.RefObject<HTMLElement | null>;
  updateSplits: (updater: (prev: SplitSizes) => SplitSizes) => void;
}

export function IdeSplitters({
  breakpoint,
  splits,
  terminalCollapsed,
  stageRef,
  updateSplits,
}: IdeSplittersProps) {
  if (breakpoint === 'desktop') {
    return (
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
    );
  }

  if (breakpoint === 'tablet') {
    return (
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
    );
  }

  return null;
}
