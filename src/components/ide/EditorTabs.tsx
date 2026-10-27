'use client';

import React from 'react';
import { FolderTree, PanelLeftClose, PanelLeftOpen, WrapText, X } from 'lucide-react';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { IconButton } from '@/components/ui/IconButton';

export function EditorTabs() {
  const { breakpoint } = useBreakpoint();
  const openTabs = useProjectStore((s) => s.openTabs);
  const activeFilePath = useProjectStore((s) => s.activeFilePath);
  const dirtyBuffers = useProjectStore((s) => s.dirtyBuffers);
  const openFile = useProjectStore((s) => s.openFile);
  const closeTab = useProjectStore((s) => s.closeTab);

  const filesTreeCollapsed = useUiStore((s) => s.filesTreeCollapsed);
  const setFilesTreeCollapsed = useUiStore((s) => s.setFilesTreeCollapsed);
  const setFilesDrawerOpen = useUiStore((s) => s.setFilesDrawerOpen);
  const editorWordWrap = useUiStore((s) => s.editorWordWrap);
  const setEditorWordWrap = useUiStore((s) => s.setEditorWordWrap);

  return (
    <div className="h-11 flex items-center justify-between border-b border-kalpa-border bg-kalpa-bg-2 px-1.5 shrink-0">
      <div className="flex items-center min-w-0 flex-1 overflow-x-auto no-scrollbar gap-1">
        {breakpoint === 'desktop' ? (
          <IconButton
            label={filesTreeCollapsed ? 'Show file tree' : 'Hide file tree'}
            size="sm"
            onClick={() => setFilesTreeCollapsed(!filesTreeCollapsed)}
          >
            {filesTreeCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </IconButton>
        ) : (
          <IconButton
            label="Open project files drawer"
            size="sm"
            onClick={() => setFilesDrawerOpen(true)}
          >
            <FolderTree className="w-4 h-4 text-kalpa-violet" />
          </IconButton>
        )}

        {openTabs.map((path) => {
          const active = path === activeFilePath;
          const dirty = dirtyBuffers[path] !== undefined;
          const filename = path.split('/').pop() ?? path;

          return (
            <div
              key={path}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(path);
                }
              }}
              className={`group inline-flex items-center gap-1.5 min-h-[34px] pl-3 pr-1.5 rounded-[8px] text-xs font-mono shrink-0 border transition-colors ${
                active
                  ? 'bg-kalpa-surface-2 border-kalpa-violet/50 text-kalpa-text'
                  : 'bg-transparent border-transparent text-kalpa-muted hover:text-kalpa-text hover:bg-kalpa-surface'
              }`}
            >
              <button
                type="button"
                onClick={() => openFile(path)}
                title={path}
                className="truncate max-w-[150px] cursor-pointer py-1"
              >
                {filename}
              </button>
              {dirty ? (
                <span
                  aria-label="Unsaved edits"
                  className="w-1.5 h-1.5 rounded-full bg-kalpa-gold shrink-0"
                />
              ) : null}
              <button
                type="button"
                aria-label={`Close ${filename}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(path);
                }}
                className="p-1 rounded hover:bg-kalpa-surface text-kalpa-muted hover:text-kalpa-text cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center shrink-0 pl-1">
        <IconButton
          label={editorWordWrap ? 'Disable line wrap' : 'Enable line wrap'}
          size="sm"
          active={editorWordWrap}
          onClick={() => setEditorWordWrap(!editorWordWrap)}
        >
          <WrapText className="w-3.5 h-3.5" />
        </IconButton>
      </div>
    </div>
  );
}
