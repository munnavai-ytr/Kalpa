'use client';

import React, { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FilePlus2,
  Trash2,
} from 'lucide-react';
import type { Action } from '@/lib/agent/actions';
import { useAgentStore, type ActionOutcomeMeta } from '@/stores/agent';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { DiffView } from '../DiffView';

export interface FileCardProps {
  action: Extract<Action, { type: 'file' | 'delete' | 'move' }>;
  outcome?: ActionOutcomeMeta;
}

export function FileCard({ action, outcome }: FileCardProps) {
  const { breakpoint } = useBreakpoint();
  const expandDefault = useAgentStore((s) => s.prefs.expandActionCards);
  const [expanded, setExpanded] = useState(expandDefault);
  const openFile = useProjectStore((s) => s.openFile);
  const setActiveIdeTab = useUiStore((s) => s.setActiveIdeTab);

  const handleOpenInEditor = (targetPath: string) => {
    openFile(targetPath);
    if (breakpoint === 'phone') setActiveIdeTab('code');
  };

  if (action.type === 'delete') {
    return (
      <div className="rounded-[10px] border border-kalpa-border bg-kalpa-bg-2 px-3 py-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Trash2 className="w-3.5 h-3.5 text-kalpa-danger shrink-0" />
          <span className="font-mono text-kalpa-text truncate">{action.path}</span>
        </div>
        <span className="text-[11px] font-mono text-kalpa-danger shrink-0">
          {outcome?.ok === false ? outcome.summary || 'Rejected' : 'Deleted'}
        </span>
      </div>
    );
  }

  if (action.type === 'move') {
    return (
      <div className="rounded-[10px] border border-kalpa-border bg-kalpa-bg-2 px-3 py-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 min-w-0 font-mono text-kalpa-text truncate">
          <span className="truncate">{action.from}</span>
          <ArrowRight className="w-3 h-3 text-kalpa-muted shrink-0" />
          <span className="truncate">{action.to}</span>
        </div>
        <button
          type="button"
          onClick={() => handleOpenInEditor(action.to)}
          className="text-[11px] text-kalpa-violet hover:underline shrink-0 cursor-pointer"
        >
          Open
        </button>
      </div>
    );
  }

  const linesCount = action.content ? action.content.split('\n').length : 0;
  const rejected = outcome?.ok === false;

  return (
    <div className="rounded-[10px] border border-kalpa-border bg-kalpa-bg-2 overflow-hidden text-xs">
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-kalpa-muted shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-kalpa-muted shrink-0" />
          )}
          <FilePlus2
            className={`w-3.5 h-3.5 shrink-0 ${rejected ? 'text-kalpa-danger' : 'text-kalpa-success'}`}
          />
          <span className="font-mono font-medium text-kalpa-text truncate">{action.path}</span>
          <span
            className={`text-[11px] font-mono shrink-0 ${
              rejected ? 'text-kalpa-danger' : 'text-kalpa-muted'
            }`}
          >
            {rejected ? outcome?.summary || 'Rejected' : `${linesCount} lines`}
          </span>
        </button>

        {!rejected ? (
          <button
            type="button"
            onClick={() => handleOpenInEditor(action.path)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] hover:bg-kalpa-surface text-[11px] text-kalpa-violet shrink-0 cursor-pointer"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="p-2 border-t border-kalpa-border bg-kalpa-bg max-h-64 overflow-y-auto">
          {outcome?.beforeContent !== undefined && outcome?.afterContent !== undefined ? (
            <DiffView
              path={action.path}
              before={outcome.beforeContent}
              after={outcome.afterContent}
            />
          ) : (
            <pre className="text-[11px] font-mono text-kalpa-text whitespace-pre-wrap break-all m-0 p-1">
              {action.content.slice(0, 4000)}
              {action.content.length > 4000 ? '\n… (truncated in card; open file in editor)' : ''}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
