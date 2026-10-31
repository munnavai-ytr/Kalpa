'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Wrench, XCircle } from 'lucide-react';
import type { DoctorIssue } from '@/lib/agent/scaffoldDoctor';
import { runProjectScaffoldDoctor } from '@/lib/agent/verify';
import type { ExtendedDetection } from '@/lib/preview/detect';
import type { EngineKind } from '@/lib/vfs/db';
import {
  usePreviewStore,
  type PreviewConsoleEntry,
  type PreviewStatus,
  type TailwindProbeState,
} from '@/stores/preview';
import { useSandboxStore } from '@/stores/sandbox';
import { useUiStore } from '@/stores/ui';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

export interface PreviewDebugSheetProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName: string | null;
  engine: EngineKind;
  detection: ExtendedDetection;
  workspaceFileCount: number;
  sandpackFileCount: number;
  status: PreviewStatus;
  expectedFilesHash: string;
  confirmedFilesHash: string;
  tailwindProbe: TailwindProbeState | null;
  entries: PreviewConsoleEntry[];
}

function formatTailwindStatus(probe: TailwindProbeState | null): string {
  if (!probe) return 'not probed yet';
  if (!probe.ok || probe.source === 'failed') return 'FAILED';
  const via = probe.source === 'self' ? 'self-hosted' : 'CDN';
  return `loaded via ${via} ${probe.runtime}`;
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
  tailwindProbe,
  entries,
}: PreviewDebugSheetProps) {
  const [checking, setChecking] = useState(false);
  const [doctorReport, setDoctorReport] = useState<{
    issues: DoctorIssue[];
    fixedCount: number;
  } | null>(null);

  const reloadPreview = usePreviewStore((s) => s.reloadPreview);
  const runDevServer = useSandboxStore((s) => s.runDevServer);
  const addToast = useUiStore((s) => s.addToast);

  useEffect(() => {
    if (!open) setDoctorReport(null);
  }, [open, projectId]);

  const handleCheckProject = async () => {
    if (!projectId || checking) return;
    setChecking(true);
    try {
      const res = await runProjectScaffoldDoctor(projectId, {
        source: 'manual-check',
        force: true,
      });
      setDoctorReport({ issues: res.issues, fixedCount: res.fixedCount });
      if (res.changedPaths.length > 0) {
        addToast({
          title: `Scaffold fixed (${res.fixedCount})`,
          kind: 'success',
        });
        if (engine === 'cloud' && (res.pkgChanged || res.configChanged)) {
          await runDevServer(projectId, res.pkgChanged);
        } else {
          reloadPreview();
        }
      }
    } finally {
      setChecking(false);
    }
  };

  const recentErrors = entries.filter((e) => e.level === 'error').slice(-5);
  const hashSynced = Boolean(expectedFilesHash && expectedFilesHash === confirmedFilesHash);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Preview Inspector"
      description="Live workspace detection, file hashes, Tailwind runtime, and bundler diagnostics."
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
          <div className="col-span-2">
            <span className="block text-[10px] uppercase text-kalpa-muted">Tailwind</span>
            <span
              className={
                !tailwindProbe
                  ? 'text-kalpa-muted'
                  : tailwindProbe.ok
                    ? 'text-kalpa-success'
                    : 'text-kalpa-danger'
              }
            >
              Tailwind: {formatTailwindStatus(tailwindProbe)}
            </span>
          </div>
        </div>

        <div className="p-3 rounded-[12px] bg-kalpa-surface border border-kalpa-border space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="block text-[10px] font-mono uppercase text-kalpa-muted">
                Scaffold Doctor
              </span>
              <p className="text-[11px] text-kalpa-muted">
                Checks PostCSS, Tailwind, Vite, TypeScript configs, assets, and undeclared imports.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!projectId || checking}
              loading={checking}
              leftIcon={<Wrench className="w-3.5 h-3.5" />}
              onClick={() => void handleCheckProject()}
            >
              Check project
            </Button>
          </div>

          {doctorReport ? (
            doctorReport.issues.length === 0 ? (
              <div className="flex items-center gap-1.5 text-[11px] text-kalpa-success pt-1 border-t border-kalpa-border/60">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>No setup issues found — project configuration is healthy.</span>
              </div>
            ) : (
              <div className="space-y-1.5 pt-1.5 border-t border-kalpa-border/60 max-h-40 overflow-y-auto">
                {doctorReport.issues.map((iss, idx) => (
                  <div key={`${iss.id}-${idx}`} className="flex items-start gap-2 text-[11px]">
                    {iss.status === 'fixed' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-kalpa-success shrink-0 mt-0.5" />
                    ) : iss.status === 'error' ? (
                      <XCircle className="w-3.5 h-3.5 text-kalpa-danger shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-kalpa-warn shrink-0 mt-0.5" />
                    )}
                    <span className="text-kalpa-text break-words">{iss.message}</span>
                  </div>
                ))}
              </div>
            )
          ) : null}
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
