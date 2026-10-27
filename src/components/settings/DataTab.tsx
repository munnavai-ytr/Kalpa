'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Download, HardDrive, Trash2, Upload } from 'lucide-react';
import { downloadAllProjectsZip } from '@/lib/vfs/zip';
import { wipeAllBrowserData } from '@/lib/providers/vault';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { formatBytes } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

export function DataTab() {
  const importProjectFromZip = useProjectStore((s) => s.importProjectFromZip);
  const addToast = useUiStore((s) => s.addToast);
  const fileRef = useRef<HTMLInputElement>(null);

  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then((est) => {
          setUsage({ used: est.usage ?? 0, quota: est.quota ?? 0 });
        })
        .catch(() => {});
    }
  }, []);

  const handleExportAll = async () => {
    setExporting(true);
    try {
      const count = await downloadAllProjectsZip();
      addToast({ title: `Exported ${count} project(s) as ZIP`, kind: 'success' });
    } catch (err) {
      addToast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const proj = await importProjectFromZip(file);
      addToast({ title: `Imported "${proj.name}"`, kind: 'success' });
    } catch (err) {
      addToast({
        title: 'ZIP import failed',
        description: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleWipeAll = async () => {
    await wipeAllBrowserData();
    window.location.href = '/';
  };

  const pct = usage && usage.quota > 0 ? Math.min(100, (usage.used / usage.quota) * 100) : 0;

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-kalpa-violet" />
          <h3 className="text-sm font-semibold text-kalpa-text">Browser Storage Usage</h3>
        </div>
        {usage ? (
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-mono tabular-nums text-kalpa-muted">
              <span>Used: {formatBytes(usage.used)}</span>
              <span>Quota: {formatBytes(usage.quota)}</span>
            </div>
            <div className="h-2 rounded-full bg-kalpa-surface overflow-hidden">
              <div
                className="h-full kalpa-grad-bg transition-all"
                style={{ width: `${Math.max(1, pct)}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-kalpa-muted">Storage estimate unavailable in this browser.</p>
        )}
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-kalpa-text">Portability &amp; Backup</h3>
        <p className="text-xs text-kalpa-muted">
          Export every project stored in IndexedDB into a standard ZIP archive, or import an
          existing ZIP archive as a new project.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <Button
            variant="secondary"
            loading={exporting}
            leftIcon={<Download className="w-4 h-4" />}
            onClick={handleExportAll}
          >
            Export all projects (ZIP)
          </Button>
          <Button
            variant="secondary"
            leftIcon={<Upload className="w-4 h-4" />}
            onClick={() => fileRef.current?.click()}
          >
            Import project ZIP
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            onChange={handleImport}
            className="hidden"
          />
        </div>
      </Card>

      <Card className="space-y-3 border-kalpa-danger/30">
        <h3 className="text-sm font-semibold text-kalpa-danger">Danger Zone</h3>
        <p className="text-xs text-kalpa-muted">
          Permanently erase all projects, files, chat histories, and saved API keys from this
          browser.
        </p>
        <div>
          <Button
            variant="danger"
            leftIcon={<Trash2 className="w-4 h-4" />}
            onClick={() => setConfirmWipe(true)}
          >
            Wipe all data
          </Button>
        </div>
      </Card>

      <Modal
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title="Wipe all local data?"
        description="This deletes the entire Kalpa IndexedDB database, all projects, and all saved API keys on this browser. This cannot be undone."
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setConfirmWipe(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleWipeAll}>
            Yes, wipe everything
          </Button>
        </div>
      </Modal>
    </div>
  );
}
