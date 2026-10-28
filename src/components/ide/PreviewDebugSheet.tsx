'use client';

import React from 'react';
import type { Detection } from '@/lib/agent/reliability';
import type { EngineKind } from '@/lib/vfs/db';
import type { PreviewConsoleEntry, PreviewStatus } from '@/stores/preview';
import { Modal } from '@/components/ui/Modal';

export interface PreviewDebugSheetProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName: string | null;
  engine: EngineKind;
  detection: Detection;
  workspaceFileCount: number;
  sandpackFileCount: number;
  status: PreviewStatus;
  expectedFilesHash: string;
  confirmedFilesHash: string;
  entries: PreviewConsoleEntry[];
}

export function PreviewDebugSheet({
  open,
  onClose,
  projectId,
  projectName,
  engine,
  detection,
  workspaceFileCount,
  sandpackFileCount,
  status,
  expectedFilesHash,
  confirmedFilesHash,
  entries,
}: PreviewDebugSheetProps) {
  const recentErrors = entries.filter((e) => e.level === 'error').slice(-5);
  const hashSynced = Boolean(expectedFilesHash && expectedFilesHash === confirmedFilesHash);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Preview Inspector"
      description="Live workspace detection, file hashes, and bundler diagnostics."
      maxWidthClass="max-w-lg"
    >
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2 p-3 rounded-[12px] bg-kalpa-surface border border-kalpa-border font-mono">
          <div>
            <span className="block text-[10px] uppercase text-kalpa-muted">Project</span>
            <span className="text-kalpa-text truncate block">
              {projectName || '(none)'} ({projectId?.slice(0, 10) || '—'})
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-kalpa-muted">Engine / Status</span>
            <span className="text-kalpa-text">
              {engine} · {status}
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-kalpa-muted">Detected Stack</span>
            <span className="text-kalpa-violet font-semibold">{detection.type}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-kalpa-muted">Entry File</span>
            <span className="text-kalpa-text truncate block">{detection.entry || '(none)'}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-kalpa-muted">Files (VFS / Bundle)</span>
            <span className="text-kalpa-text">
              {workspaceFileCount} workspace · {sandpackFileCount} bundled
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-kalpa-muted">Freshness Hash</span>
            <span className={hashSynced ? 'text-kalpa-success' : 'text-kalpa-warn'}>
              {expectedFilesHash || '—'} / {confirmedFilesHash || 'pending'}
            </span>
          </div>
        </div>

        <div className="p-3 rounded-[12px] bg-kalpa-surface border border-kalpa-border space-y-1">
          <span className="text-[10px] font-mono uppercase text-kalpa-muted">Detection Reason</span>
          <p className="text-kalpa-text leading-relaxed">{detection.reason}</p>
        </div>

        <div className="p-3 rounded-[12px] bg-kalpa-surface border border-kalpa-border space-y-1.5">
          <span className="text-[10px] font-mono uppercase text-kalpa-muted">
            Recent Errors ({recentErrors.length})
          </span>
          {recentErrors.length === 0 ? (
            <p className="text-kalpa-muted">No preview errors recorded in this session.</p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto font-mono text-[11px]">
              {recentErrors.map((err) => (
                <div key={err.id} className="text-kalpa-danger whitespace-pre-wrap break-words">
                  {err.file ? `[${err.file}${err.line ? `:${err.line}` : ''}] ` : ''}
                  {err.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
