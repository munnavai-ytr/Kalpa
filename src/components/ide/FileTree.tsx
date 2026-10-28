'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  FileCode,
  FileImage,
  FileJson,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Lock,
  MoreHorizontal,
  Search,
  Upload,
} from 'lucide-react';
import { isBrainPath } from '@/lib/brain/caps';
import { vfs } from '@/lib/vfs/vfs';
import { isBinaryPath, isImagePath, normalisePath } from '@/lib/vfs/paths';
import { buildFileTreeRows, type TreeRow } from '@/lib/vfs/fileTreeRows';
import { importZipIntoExistingProject } from '@/lib/vfs/zip';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { IconButton } from '@/components/ui/IconButton';
import { FileTreeDialogs, type FileTreeDialogMode } from './FileTreeDialogs';

export function FileTree({ onFileChosen }: { onFileChosen?: () => void }) {
  const currentProject = useProjectStore((s) => s.currentProject);
  const files = useProjectStore((s) => s.files);
  const activeFilePath = useProjectStore((s) => s.activeFilePath);
  const dirtyBuffers = useProjectStore((s) => s.dirtyBuffers);
  const openFile = useProjectStore((s) => s.openFile);
  const setActiveIdeTab = useUiStore((s) => s.setActiveIdeTab);
  const addToast = useUiStore((s) => s.addToast);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['.kalpa']));
  const [scrollTop, setScrollTop] = useState(0);
  const [dialogMode, setDialogMode] = useState<FileTreeDialogMode>(null);
  const [inputVal, setInputVal] = useState('');
  const [menuRow, setMenuRow] = useState<{ row: TreeRow; x: number; y: number } | null>(null);

  const { rows, folders } = useMemo(
    () => buildFileTreeRows(files, collapsed, query),
    [files, collapsed, query]
  );

  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentProject || !e.target.files?.length) return;
    const list = Array.from(e.target.files);
    try {
      for (const file of list) {
        const path = normalisePath(file.name);
        if (isBinaryPath(path)) {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          await vfs.write(currentProject.id, path, btoa(binary), 'base64');
        } else {
          const text = await file.text();
          await vfs.write(currentProject.id, path, text, 'utf8');
        }
      }
      addToast({ title: `Uploaded ${list.length} file(s)`, kind: 'success' });
    } catch (err) {
      addToast({
        title: 'Upload failed',
        description: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleImportZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!currentProject || !file) return;
    try {
      const count = await importZipIntoExistingProject(currentProject.id, file);
      addToast({ title: `Imported ${count} files from ZIP`, kind: 'success' });
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

  const submitDialog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject || !dialogMode) return;
    try {
      if (dialogMode.kind === 'new-file') {
        const path = normalisePath(inputVal);
        if (isBrainPath(path)) throw new Error('Brain files are managed via the Brain panel.');
        await vfs.write(currentProject.id, path, '');
        openFile(path);
        setActiveIdeTab('code');
        onFileChosen?.();
      } else if (dialogMode.kind === 'new-folder') {
        const folder = normalisePath(inputVal);
        if (isBrainPath(folder)) throw new Error('Reserved folder .kalpa');
        await vfs.write(currentProject.id, `${folder}/.gitkeep`, '');
      } else if (dialogMode.kind === 'rename') {
        await vfs.move(currentProject.id, dialogMode.row.path, normalisePath(inputVal));
      } else if (dialogMode.kind === 'move') {
        const destFolder = inputVal.trim() ? normalisePath(inputVal) : '';
        const dest = destFolder ? `${destFolder}/${dialogMode.row.name}` : dialogMode.row.name;
        await vfs.move(currentProject.id, dialogMode.row.path, dest);
      } else if (dialogMode.kind === 'delete') {
        await vfs.remove(currentProject.id, dialogMode.row.path);
      }
      setDialogMode(null);
    } catch (err) {
      addToast({
        title: 'File operation failed',
        description: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    }
  };

  const handleDuplicate = async (row: TreeRow) => {
    if (!currentProject || row.isFolder || isBrainPath(row.path)) return;
    const data = await vfs.read(currentProject.id, row.path);
    if (!data) return;
    const dot = row.path.lastIndexOf('.');
    const copyPath =
      dot > 0 ? `${row.path.slice(0, dot)}.copy${row.path.slice(dot)}` : `${row.path}.copy`;
    await vfs.write(currentProject.id, copyPath, data.content, data.encoding);
    openFile(copyPath);
  };

  const isVirtualized = rows.length > 200;
  const ROW_H = 38;
  const startIdx = isVirtualized ? Math.max(0, Math.floor(scrollTop / ROW_H) - 8) : 0;
  const endIdx = isVirtualized ? Math.min(rows.length, startIdx + 36) : rows.length;
  const visibleRows = rows.slice(startIdx, endIdx);

  return (
    <div className="h-full flex flex-col bg-kalpa-bg-2 select-none">
      <div className="p-2 border-b border-kalpa-border space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-semibold text-kalpa-muted px-1.5">Files</span>
          <div className="flex items-center">
            <IconButton
              label="New file"
              size="sm"
              onClick={() => {
                setInputVal('');
                setDialogMode({ kind: 'new-file' });
              }}
            >
              <FilePlus className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton
              label="New folder"
              size="sm"
              onClick={() => {
                setInputVal('');
                setDialogMode({ kind: 'new-folder' });
              }}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton
              label="Upload files"
              size="sm"
              onClick={() => uploadInputRef.current?.click()}
            >
              <Upload className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-kalpa-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files…"
            aria-label="Filter files"
            className="w-full min-h-[36px] pl-8 pr-2.5 rounded-[8px] bg-kalpa-surface border border-kalpa-border text-xs text-kalpa-text placeholder:text-kalpa-muted focus:outline-none focus:border-kalpa-violet"
          />
        </div>

        <input ref={uploadInputRef} type="file" multiple onChange={handleUploadFiles} className="hidden" />
        <input ref={zipInputRef} type="file" accept=".zip" onChange={handleImportZip} className="hidden" />
      </div>

      <div
        onScroll={(e) => isVirtualized && setScrollTop(e.currentTarget.scrollTop)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          const dragged = e.dataTransfer.getData('text/kalpa-path');
          if (dragged && !isBrainPath(dragged) && currentProject && dragged.includes('/')) {
            await vfs.move(currentProject.id, dragged, dragged.split('/').pop()!).catch(() => {});
          }
        }}
        className="flex-1 min-h-0 overflow-y-auto p-1.5"
      >
        <div style={isVirtualized ? { height: rows.length * ROW_H, position: 'relative' } : undefined}>
          {visibleRows.map((row, idx) => {
            const isOpenDir = row.isFolder && !collapsed.has(row.path);
            const isActive = !row.isFolder && activeFilePath === row.path;
            const isDirty = !row.isFolder && dirtyBuffers[row.path] !== undefined;
            const inBrain = isBrainPath(row.path);

            return (
              <div
                key={row.path}
                draggable={!inBrain}
                onDragStart={(e) => {
                  if (!inBrain) e.dataTransfer.setData('text/kalpa-path', row.path);
                }}
                onDragOver={(e) => {
                  if (row.isFolder && !inBrain) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                onDrop={async (e) => {
                  if (!row.isFolder || inBrain || !currentProject) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const src = e.dataTransfer.getData('text/kalpa-path');
                  if (!src || isBrainPath(src) || src === row.path || row.path.startsWith(`${src}/`)) return;
                  await vfs.move(currentProject.id, src, `${row.path}/${src.split('/').pop()!}`).catch(() => {});
                }}
                onContextMenu={(e) => {
                  if (inBrain) return;
                  e.preventDefault();
                  setMenuRow({ row, x: e.clientX, y: e.clientY });
                }}
                style={
                  isVirtualized
                    ? { position: 'absolute', top: (startIdx + idx) * ROW_H, left: 0, right: 0, height: ROW_H }
                    : undefined
                }
                className={`group flex items-center justify-between rounded-[8px] min-h-[38px] pr-1 transition-colors ${
                  isActive
                    ? 'bg-kalpa-violet/20 text-kalpa-text'
                    : 'text-kalpa-muted hover:text-kalpa-text hover:bg-kalpa-surface'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (row.isFolder) toggleFolder(row.path);
                    else {
                      openFile(row.path);
                      onFileChosen?.();
                    }
                  }}
                  style={{ paddingLeft: `${row.depth * 12 + 8}px` }}
                  className="flex-1 min-w-0 flex items-center gap-1.5 py-1.5 text-left text-xs cursor-pointer"
                >
                  {row.isFolder ? (
                    <>
                      {isOpenDir ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                      {row.isBrainFolder ? (
                        <Brain className="w-3.5 h-3.5 text-kalpa-rose shrink-0" />
                      ) : isOpenDir ? (
                        <FolderOpen className="w-3.5 h-3.5 text-kalpa-gold shrink-0" />
                      ) : (
                        <Folder className="w-3.5 h-3.5 text-kalpa-gold shrink-0" />
                      )}
                    </>
                  ) : isImagePath(row.path) ? (
                    <FileImage className="w-3.5 h-3.5 text-kalpa-gold shrink-0" />
                  ) : row.path.endsWith('.json') ? (
                    <FileJson className="w-3.5 h-3.5 text-kalpa-warn shrink-0" />
                  ) : /\.(tsx?|jsx?|py|html|css)$/.test(row.path) ? (
                    <FileCode className="w-3.5 h-3.5 text-kalpa-violet shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-kalpa-muted shrink-0" />
                  )}
                  <span className={`truncate ${row.isBrainFolder ? 'font-semibold text-kalpa-text' : 'font-mono'}`}>
                    {row.name}
                  </span>
                  {row.isReadOnly ? (
                    <Lock className="w-3 h-3 text-kalpa-muted shrink-0 ml-1" />
                  ) : null}
                  {isDirty ? (
                    <span aria-label="Unsaved changes" className="w-1.5 h-1.5 rounded-full bg-kalpa-gold shrink-0 ml-1" />
                  ) : null}
                </button>

                {!inBrain ? (
                  <button
                    type="button"
                    aria-label={`Actions for ${row.name}`}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setMenuRow({ row, x: rect.left, y: rect.bottom });
                    }}
                    className="p-1.5 rounded-md opacity-70 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-kalpa-surface-2 cursor-pointer shrink-0"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="pt-3 px-2">
          <button
            type="button"
            onClick={() => zipInputRef.current?.click()}
            className="text-[11px] text-kalpa-muted hover:text-kalpa-text underline cursor-pointer"
          >
            Import ZIP into workspace…
          </button>
        </div>
      </div>

      <FileTreeDialogs
        menuRow={menuRow}
        onCloseMenu={() => setMenuRow(null)}
        onPickRename={(row) => {
          setInputVal(row.path);
          setDialogMode({ kind: 'rename', row });
        }}
        onPickDuplicate={handleDuplicate}
        onPickMove={(row) => {
          const parent = row.path.includes('/') ? row.path.split('/').slice(0, -1).join('/') : '';
          setInputVal(parent);
          setDialogMode({ kind: 'move', row });
        }}
        onPickDelete={(row) => setDialogMode({ kind: 'delete', row })}
        dialogMode={dialogMode}
        onCloseDialog={() => setDialogMode(null)}
        inputVal={inputVal}
        onChangeInputVal={setInputVal}
        folders={folders}
        onSubmitDialog={submitDialog}
      />
    </div>
  );
}
