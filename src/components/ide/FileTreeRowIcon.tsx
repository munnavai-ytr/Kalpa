'use client';

import React from 'react';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
} from 'lucide-react';
import { isImagePath } from '@/lib/vfs/paths';
import type { TreeRow } from '@/lib/vfs/fileTreeRows';

export interface FileTreeRowIconProps {
  row: TreeRow;
  isOpenDir: boolean;
}

export function FileTreeRowIcon({ row, isOpenDir }: FileTreeRowIconProps) {
  if (row.isFolder) {
    return (
      <>
        {isOpenDir ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        )}
        {row.isBrainFolder ? (
          <Brain className="w-3.5 h-3.5 text-kalpa-rose shrink-0" />
        ) : isOpenDir ? (
          <FolderOpen className="w-3.5 h-3.5 text-kalpa-gold shrink-0" />
        ) : (
          <Folder className="w-3.5 h-3.5 text-kalpa-gold shrink-0" />
        )}
      </>
    );
  }
  if (isImagePath(row.path)) {
    return <FileImage className="w-3.5 h-3.5 text-kalpa-gold shrink-0" />;
  }
  if (row.path.endsWith('.json')) {
    return <FileJson className="w-3.5 h-3.5 text-kalpa-warn shrink-0" />;
  }
  if (/\.(tsx?|jsx?|py|html|css)$/.test(row.path)) {
    return <FileCode className="w-3.5 h-3.5 text-kalpa-violet shrink-0" />;
  }
  return <FileText className="w-3.5 h-3.5 text-kalpa-muted shrink-0" />;
}
