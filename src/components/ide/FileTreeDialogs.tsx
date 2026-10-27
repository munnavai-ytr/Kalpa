'use client';

import React from 'react';
import type { TreeRow } from '@/lib/vfs/fileTreeRows';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export type FileTreeDialogMode =
  | null
  | { kind: 'new-file' | 'new-folder' }
  | { kind: 'rename'; row: TreeRow }
  | { kind: 'move'; row: TreeRow }
  | { kind: 'delete'; row: TreeRow };

export interface FileTreeDialogsProps {
  menuRow: { row: TreeRow; x: number; y: number } | null;
  onCloseMenu: () => void;
  onPickRename: (row: TreeRow) => void;
  onPickDuplicate: (row: TreeRow) => void;
  onPickMove: (row: TreeRow) => void;
  onPickDelete: (row: TreeRow) => void;
  dialogMode: FileTreeDialogMode;
  onCloseDialog: () => void;
  inputVal: string;
  onChangeInputVal: (val: string) => void;
  folders: string[];
  onSubmitDialog: (e: React.FormEvent) => void;
}

export function FileTreeDialogs({
  menuRow,
  onCloseMenu,
  onPickRename,
  onPickDuplicate,
  onPickMove,
  onPickDelete,
  dialogMode,
  onCloseDialog,
  inputVal,
  onChangeInputVal,
  folders,
  onSubmitDialog,
}: FileTreeDialogsProps) {
  return (
    <>
      {menuRow ? (
        <div className="fixed inset-0 z-50" onClick={onCloseMenu}>
          <div
            style={{
              top: Math.min(window.innerHeight - 190, menuRow.y),
              left: Math.min(window.innerWidth - 170, Math.max(8, menuRow.x - 80)),
            }}
            onClick={(e) => e.stopPropagation()}
            className="fixed w-40 rounded-[12px] bg-kalpa-bg-2 border border-kalpa-border shadow-kalpa-soft p-1 text-xs"
          >
            <button
              type="button"
              onClick={() => {
                onPickRename(menuRow.row);
                onCloseMenu();
              }}
              className="w-full text-left px-3 py-2 rounded-[8px] text-kalpa-text hover:bg-kalpa-surface cursor-pointer"
            >
              Rename
            </button>
            {!menuRow.row.isFolder ? (
              <button
                type="button"
                onClick={() => {
                  onPickDuplicate(menuRow.row);
                  onCloseMenu();
                }}
                className="w-full text-left px-3 py-2 rounded-[8px] text-kalpa-text hover:bg-kalpa-surface cursor-pointer"
              >
                Duplicate
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                onPickMove(menuRow.row);
                onCloseMenu();
              }}
              className="w-full text-left px-3 py-2 rounded-[8px] text-kalpa-text hover:bg-kalpa-surface cursor-pointer"
            >
              Move to…
            </button>
            <button
              type="button"
              onClick={() => {
                onPickDelete(menuRow.row);
                onCloseMenu();
              }}
              className="w-full text-left px-3 py-2 rounded-[8px] text-kalpa-danger hover:bg-kalpa-danger/10 cursor-pointer"
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}

      <Modal
        open={Boolean(dialogMode)}
        onClose={onCloseDialog}
        title={
          dialogMode?.kind === 'new-file'
            ? 'New file'
            : dialogMode?.kind === 'new-folder'
              ? 'New folder'
              : dialogMode?.kind === 'rename'
                ? 'Rename path'
                : dialogMode?.kind === 'move'
                  ? 'Move to folder'
                  : 'Delete from project?'
        }
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={onSubmitDialog} className="space-y-4">
          {dialogMode?.kind === 'delete' ? (
            <p className="text-sm text-kalpa-muted">
              Delete <code className="font-mono text-kalpa-text">{dialogMode.row.path}</code>?
            </p>
          ) : dialogMode?.kind === 'move' ? (
            <div className="space-y-2">
              <label className="block text-xs text-kalpa-muted">Destination folder (empty for root)</label>
              <select
                value={inputVal}
                onChange={(e) => onChangeInputVal(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono text-kalpa-text"
              >
                <option value="">/ (Project root)</option>
                {folders
                  .filter((f) => f !== dialogMode.row.path && !f.startsWith(`${dialogMode.row.path}/`))
                  .map((f) => (
                    <option key={f} value={f}>
                      /{f}
                    </option>
                  ))}
              </select>
            </div>
          ) : (
            <input
              value={inputVal}
              onChange={(e) => onChangeInputVal(e.target.value)}
              placeholder={dialogMode?.kind === 'new-file' ? 'src/Component.tsx' : 'src/utils'}
              autoFocus
              required
              className="w-full min-h-[44px] px-3.5 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono text-kalpa-text"
            />
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCloseDialog}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={dialogMode?.kind === 'delete' ? 'danger' : 'primary'}
            >
              {dialogMode?.kind === 'delete' ? 'Delete' : 'Confirm'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
