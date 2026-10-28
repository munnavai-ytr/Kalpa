'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, History, Redo2, Undo2 } from 'lucide-react';
import { restoreCheckpoint } from '@/lib/checkpoints/checkpoints';
import type { ChatRecord } from '@/lib/vfs/db';
import { useAgentStore } from '@/stores/agent';
import { useBrainStore } from '@/stores/brain';
import { useChatStore } from '@/stores/chat';
import { usePreviewStore } from '@/stores/preview';
import { useUiStore } from '@/stores/ui';
import { DiffView } from './DiffView';

export interface TurnFooterProps {
  message: ChatRecord;
}

export function TurnFooter({ message }: TurnFooterProps) {
  const [showDiffs, setShowDiffs] = useState(false);
  const [busy, setBusy] = useState(false);

  const undoTurnMessage = useAgentStore((s) => s.undoTurnMessage);
  const redoTurnMessage = useAgentStore((s) => s.redoTurnMessage);
  const loadChat = useChatStore((s) => s.loadChat);
  const refreshBrainFromVfs = useBrainStore((s) => s.refreshBrainFromVfs);
  const reloadPreview = usePreviewStore((s) => s.reloadPreview);
  const addToast = useUiStore((s) => s.addToast);

  const meta = message.meta;
  if (!meta || meta.plainChat) return null;

  const filesChanged = meta.filesChanged ?? [];
  const durationSec = meta.durationMs ? (meta.durationMs / 1000).toFixed(1) : null;
  const hasUndo = Boolean(meta.beforeCheckpointId) && filesChanged.length > 0 && !meta.redoCheckpointId;
  const hasRedo = Boolean(meta.redoCheckpointId);

  const handleUndo = async () => {
    setBusy(true);
    try {
      const res = await undoTurnMessage(message.projectId, message.id);
      await loadChat(message.projectId);
      addToast({ title: res.label, kind: res.ok ? 'success' : 'warn' });
    } finally {
      setBusy(false);
    }
  };

  const handleRedo = async () => {
    setBusy(true);
    try {
      const res = await redoTurnMessage(message.projectId, message.id);
      await loadChat(message.projectId);
      addToast({ title: res.label, kind: res.ok ? 'success' : 'warn' });
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreAfter = async () => {
    if (!meta.afterCheckpointId) return;
    setBusy(true);
    try {
      await restoreCheckpoint(meta.afterCheckpointId);
      await refreshBrainFromVfs(message.projectId);
      reloadPreview();
      addToast({ title: 'Restored workspace to end of this turn', kind: 'success' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-kalpa-muted border-t border-kalpa-border/60 pt-2">
        <div className="flex flex-wrap items-center gap-2.5">
          {filesChanged.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowDiffs((v) => !v)}
              className="inline-flex items-center gap-1 text-kalpa-text hover:text-kalpa-violet cursor-pointer"
            >
              {showDiffs ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span>
                {filesChanged.length} file{filesChanged.length === 1 ? '' : 's'} changed
              </span>
            </button>
          ) : (
            <span>0 files changed</span>
          )}

          {durationSec ? <span>· {durationSec}s</span> : null}

          {meta.usage?.input || meta.usage?.output ? (
            <span>
              · {meta.usage.input ?? 0} in / {meta.usage.output ?? 0} out
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {hasUndo ? (
            <button
              type="button"
              disabled={busy}
              onClick={handleUndo}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-kalpa-surface hover:bg-kalpa-border text-kalpa-text cursor-pointer disabled:opacity-50"
            >
              <Undo2 className="w-3 h-3" />
              Undo turn
            </button>
          ) : null}

          {hasRedo ? (
            <button
              type="button"
              disabled={busy}
              onClick={handleRedo}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-kalpa-violet/20 hover:bg-kalpa-violet/30 text-kalpa-violet cursor-pointer disabled:opacity-50"
            >
              <Redo2 className="w-3 h-3" />
              Redo
            </button>
          ) : null}

          {meta.afterCheckpointId ? (
            <button
              type="button"
              disabled={busy}
              onClick={handleRestoreAfter}
              title="Restore workspace to this exact turn snapshot"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-kalpa-surface text-kalpa-muted hover:text-kalpa-text cursor-pointer disabled:opacity-50"
            >
              <History className="w-3 h-3" />
              Restore here
            </button>
          ) : null}
        </div>
      </div>

      {showDiffs && filesChanged.length > 0 ? (
        <div className="space-y-2 max-h-72 overflow-y-auto pt-1">
          {filesChanged.map((fc) => (
            <DiffView key={fc.path} path={fc.path} before={fc.before} after={fc.after} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
