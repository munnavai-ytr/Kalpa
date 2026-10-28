'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Code2,
  Copy,
  Download,
  FileCode2,
  FileText,
  FolderOpen,
  Globe,
  Layers,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ProjectRecord, StackKind } from '@/lib/vfs/db';
import { STARTER_OPTIONS } from '@/lib/vfs/starters';
import { downloadProjectZip } from '@/lib/vfs/zip';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';

function StackIcon({ stack }: { stack: StackKind }) {
  const cls = 'w-4 h-4 text-kalpa-violet shrink-0';
  switch (stack) {
    case 'next':
      return <Layers className={cls} />;
    case 'react':
      return <Code2 className={cls} />;
    case 'html':
      return <Globe className={cls} />;
    case 'python':
      return <FileCode2 className={cls} />;
    case 'auto':
      return <Sparkles className={cls} />;
    default:
      return <FileText className={cls} />;
  }
}

export function RecentProjects() {
  const router = useRouter();
  const projects = useProjectStore((s) => s.projects);
  const loading = useProjectStore((s) => s.loadingProjects);
  const createProject = useProjectStore((s) => s.createProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const duplicateProject = useProjectStore((s) => s.duplicateProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const importProjectFromZip = useProjectStore((s) => s.importProjectFromZip);
  const importProjectFromFolder = useProjectStore((s) => s.importProjectFromFolder);
  const addToast = useUiStore((s) => s.addToast);

  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingProj, setRenamingProj] = useState<ProjectRecord | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deletingProj, setDeletingProj] = useState<ProjectRecord | null>(null);

  const handleStarterQuickCreate = async (stack: StackKind, label: string) => {
    const p = await createProject({ name: label, stack });
    router.push(`/ide?p=${encodeURIComponent(p.id)}`);
  };

  const handleImportZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const p = await importProjectFromZip(file);
      addToast({ title: `Imported "${p.name}"`, kind: 'success' });
      router.push(`/ide?p=${encodeURIComponent(p.id)}`);
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

  const handleImportFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      const p = await importProjectFromFolder(files);
      addToast({ title: `Imported folder "${p.name}"`, kind: 'success' });
      router.push(`/ide?p=${encodeURIComponent(p.id)}`);
    } catch (err) {
      addToast({
        title: 'Folder import failed',
        description: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    } finally {
      e.target.value = '';
    }
  };

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingProj || !renameDraft.trim()) return;
    await renameProject(renamingProj.id, renameDraft.trim());
    setRenamingProj(null);
    addToast({ title: 'Project renamed', kind: 'success' });
  };

  const confirmDelete = async () => {
    if (!deletingProj) return;
    await deleteProject(deletingProj.id);
    setDeletingProj(null);
    addToast({ title: 'Project deleted', kind: 'info' });
  };

  return (
    <section className="space-y-4 w-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight text-kalpa-text">Your projects</h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<FolderOpen className="w-3.5 h-3.5" />}
            onClick={() => folderInputRef.current?.click()}
          >
            Import Folder
          </Button>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Upload className="w-3.5 h-3.5" />}
            onClick={() => zipInputRef.current?.click()}
          >
            Import ZIP
          </Button>
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={handleImportZip}
            className="hidden"
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
            onChange={handleImportFolder}
            className="hidden"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : projects.length === 0 ? (
        <Card className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-kalpa-text">No projects on this device yet</p>
            <p className="text-xs text-kalpa-muted">
              Enter a prompt above, import a ZIP archive, or launch a working starter template:
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {STARTER_OPTIONS.filter((s) => s.id !== 'auto').map((starter) => (
              <Button
                key={starter.id}
                size="sm"
                variant="secondary"
                onClick={() => handleStarterQuickCreate(starter.id, starter.label)}
              >
                {starter.label}
              </Button>
            ))}
          </div>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="relative group rounded-[16px] bg-kalpa-bg-2 border border-kalpa-border hover:border-kalpa-violet/50 transition-colors p-4 flex items-start justify-between gap-2"
            >
              <button
                type="button"
                onClick={() => router.push(`/ide?p=${encodeURIComponent(p.id)}`)}
                className="flex-1 min-w-0 text-left cursor-pointer space-y-1.5"
              >
                <div className="flex items-center gap-2">
                  <StackIcon stack={p.stack} />
                  <span className="text-sm font-semibold text-kalpa-text truncate">{p.name}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-kalpa-muted tabular-nums">
                  <span className="capitalize">{p.stack}</span>
                  <span aria-hidden="true">·</span>
                  <span>Updated {formatRelativeTime(p.updatedAt)}</span>
                </div>
              </button>

              <div className="relative shrink-0">
                <IconButton
                  label={`Actions for ${p.name}`}
                  size="sm"
                  onClick={() => setMenuOpenId(menuOpenId === p.id ? null : p.id)}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </IconButton>

                {menuOpenId === p.id ? (
                  <div
                    onMouseLeave={() => setMenuOpenId(null)}
                    className="absolute right-0 top-full mt-1 z-30 w-44 rounded-[12px] bg-kalpa-bg-2 border border-kalpa-border shadow-kalpa-soft p-1"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpenId(null);
                        router.push(`/ide?p=${encodeURIComponent(p.id)}`);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-kalpa-text hover:bg-kalpa-surface rounded-[8px] cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" /> Open
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpenId(null);
                        setRenamingProj(p);
                        setRenameDraft(p.name);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-kalpa-text hover:bg-kalpa-surface rounded-[8px] cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Rename
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setMenuOpenId(null);
                        const copy = await duplicateProject(p.id);
                        if (copy) addToast({ title: `Duplicated "${copy.name}"`, kind: 'success' });
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-kalpa-text hover:bg-kalpa-surface rounded-[8px] cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" /> Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setMenuOpenId(null);
                        await downloadProjectZip(p.id, p.name);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-kalpa-text hover:bg-kalpa-surface rounded-[8px] cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" /> Export ZIP
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpenId(null);
                        setDeletingProj(p);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-kalpa-danger hover:bg-kalpa-danger/10 rounded-[8px] cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(renamingProj)}
        onClose={() => setRenamingProj(null)}
        title="Rename project"
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={submitRename} className="space-y-4">
          <input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            autoFocus
            className="w-full min-h-[44px] px-3.5 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm text-kalpa-text"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenamingProj(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(deletingProj)}
        onClose={() => setDeletingProj(null)}
        title="Delete project?"
        description={`"${deletingProj?.name ?? ''}" and all its files and chat history will be permanently removed from this browser.`}
        maxWidthClass="max-w-sm"
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setDeletingProj(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete}>
            Delete
          </Button>
        </div>
      </Modal>
    </section>
  );
}
