'use client';

import React, { useEffect, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import type { CheckpointRecord } from '@/lib/vfs/db';
import {
  diffCheckpointTrees,
  getBlobText,
  listCheckpoints,
  restoreCheckpoint,
} from '@/lib/checkpoints/checkpoints';
import { useBrainStore } from '@/stores/brain';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { formatRelativeTime } from '@/lib/utils';
import { Sheet } from '@/components/ui/Sheet';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { DiffView } from './DiffView';

export function HistorySheet() {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);
  const snapshot = useProjectStore((s) => s.snapshot);
  const historyOpen = useBrainStore((s) => s.historyOpen);
  const setHistoryOpen = useBrainStore((s) => s.setHistoryOpen);
  const refreshBrainFromVfs = useBrainStore((s) => s.refreshBrainFromVfs);
  const addToast = useUiStore((s) => s.addToast);

  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedBlobText, setSelectedBlobText] = useState<string>('');
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!historyOpen || !currentProject) return;
    listCheckpoints(currentProject.id).then((list) => {
      setCheckpoints(list);
      setSelectedId(list[0]?.id ?? null);
      setSelectedFile(null);
    });
  }, [historyOpen, currentProject]);

  const selectedIndex = checkpoints.findIndex((c) => c.id === selectedId);
  const selectedCp = selectedIndex >= 0 ? checkpoints[selectedIndex] : null;
  const olderCp = selectedIndex >= 0 ? checkpoints[selectedIndex + 1] ?? null : null;

  const selectedDiff = selectedCp
    ? diffCheckpointTrees(olderCp ? olderCp.tree : {}, selectedCp.tree)
    : { added: [], removed: [], modified: [] };

  const allChangedPaths = [
    ...selectedDiff.modified,
    ...selectedDiff.added,
    ...selectedDiff.removed,
  ];

  const activeDiffPath =
    selectedFile && allChangedPaths.includes(selectedFile)
      ? selectedFile
      : allChangedPaths[0] ?? null;

  const [olderBlobText, setOlderBlobText] = useState('');

  useEffect(() => {
    if (!selectedCp || !activeDiffPath) return;
    let cancelled = false;
    Promise.all([
      getBlobText(olderCp?.tree[activeDiffPath]),
      getBlobText(selectedCp.tree[activeDiffPath]),
    ]).then(([oldTxt, newTxt]) => {
      if (cancelled) return;
      setOlderBlobText(oldTxt);
      setSelectedBlobText(newTxt);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCp, olderCp, activeDiffPath]);

  const handleRestore = async (cp: CheckpointRecord) => {
    if (!currentProject || restoring) return;
    setRestoring(true);
    try {
      await restoreCheckpoint(cp.id);
      await refreshBrainFromVfs(currentProject.id);
      const updated = await listCheckpoints(currentProject.id);
      setCheckpoints(updated);
      addToast({ title: `Restored "${cp.label}"`, kind: 'success' });
      setHistoryOpen(false);
    } catch (err) {
      addToast({
        title: 'Restore failed',
        description: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    } finally {
      setRestoring(false);
    }
  };

  void snapshot;

  const content = (
    <div className="space-y-4">
      {checkpoints.length === 0 ? (
        <div className="py-10 text-center text-kalpa-muted space-y-1.5">
          <History className="w-7 h-7 mx-auto text-kalpa-border" />
          <p className="text-sm font-medium text-kalpa-text">No checkpoints yet</p>
          <p className="text-xs">
            Every AI turn and Brain edit automatically saves a full SHA-1 workspace snapshot.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-12 gap-4">
          {/* Checkpoint timeline list */}
          <div className="sm:col-span-5 max-h-[54vh] overflow-y-auto space-y-1.5 pr-1">
            {checkpoints.map((cp, idx) => {
              const prev = checkpoints[idx + 1];
              const diff = diffCheckpointTrees(prev ? prev.tree : {}, cp.tree);
              const isSel = cp.id === selectedCp?.id;
              return (
                <button
                  key={cp.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(cp.id);
                    setSelectedFile(null);
                  }}
                  className={`w-full text-left p-3 rounded-[12px] border transition-colors cursor-pointer ${
                    isSel
                      ? 'border-kalpa-violet bg-kalpa-violet/15'
                      : 'border-kalpa-border bg-kalpa-bg-2 hover:bg-kalpa-surface'
                  }`}
                >
                  <p className="text-xs font-semibold text-kalpa-text truncate">{cp.label}</p>
                  <div className="flex items-center justify-between gap-2 mt-1 text-[11px] text-kalpa-muted font-mono tabular-nums">
                    <span>{formatRelativeTime(cp.createdAt)}</span>
                    <span>
                      +{diff.added.length} ~{diff.modified.length} -{diff.removed.length}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected checkpoint diff & restore */}
          <div className="sm:col-span-7 space-y-3 min-w-0">
            {selectedCp ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-[12px] bg-kalpa-bg-2 border border-kalpa-border">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-kalpa-text truncate">
                      {selectedCp.label}
                    </p>
                    <p className="text-[11px] text-kalpa-muted font-mono tabular-nums">
                      {Object.keys(selectedCp.tree).length} files in snapshot ·{' '}
                      {new Date(selectedCp.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={restoring}
                    leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                    onClick={() => handleRestore(selectedCp)}
                  >
                    Restore
                  </Button>
                </div>

                {allChangedPaths.length > 0 ? (
                  <>
                    <div className="flex items-center gap-1 overflow-x-auto pb-1">
                      {allChangedPaths.slice(0, 30).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setSelectedFile(p)}
                          className={`px-2.5 py-1 rounded-[8px] font-mono text-[11px] whitespace-nowrap cursor-pointer ${
                            activeDiffPath === p
                              ? 'bg-kalpa-violet/20 text-kalpa-text'
                              : 'bg-kalpa-surface text-kalpa-muted hover:text-kalpa-text'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>

                    {activeDiffPath ? (
                      <DiffView
                        path={activeDiffPath}
                        before={olderBlobText}
                        after={selectedBlobText}
                        maxHeightClass="max-h-64"
                      />
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-kalpa-muted p-4 text-center">
                    Identical file tree to the preceding checkpoint.
                  </p>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );

  if (breakpoint === 'phone') {
    return (
      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Checkpoints & Undo">
        <div className="p-4">{content}</div>
      </Sheet>
    );
  }

  return (
    <Modal
      open={historyOpen}
      onClose={() => setHistoryOpen(false)}
      title="Checkpoints & Workspace History"
      maxWidthClass="max-w-4xl"
    >
      {content}
    </Modal>
  );
}
