'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, FilePenLine } from 'lucide-react';
import type { Action } from '@/lib/agent/actions';
import { useAgentStore, type ActionOutcomeMeta } from '@/stores/agent';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { DiffView } from '../DiffView';

export interface EditCardProps {
  action: Extract<Action, { type: 'edit' }>;
  outcome?: ActionOutcomeMeta;
}

export function EditCard({ action, outcome }: EditCardProps) {
  const { breakpoint } = useBreakpoint();
  const expandDefault = useAgentStore((s) => s.prefs.expandActionCards);
  const [expanded, setExpanded] = useState(expandDefault);
  const openFile = useProjectStore((s) => s.openFile);
  const setActiveIdeTab = useUiStore((s) => s.setActiveIdeTab);

  const failed = outcome?.ok === false;

  return (
    <div
      className={`rounded-[10px] border overflow-hidden text-xs ${
        failed ? 'border-kalpa-danger/40 bg-kalpa-danger/5' : 'border-kalpa-border bg-kalpa-bg-2'
      }`}
    >
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
          <FilePenLine
            className={`w-3.5 h-3.5 shrink-0 ${failed ? 'text-kalpa-danger' : 'text-kalpa-gold'}`}
          />
          <span className="font-mono font-medium text-kalpa-text truncate">{action.path}</span>
          <span
            className={`text-[11px] font-mono shrink-0 ${
              failed ? 'text-kalpa-danger' : 'text-kalpa-muted'
            }`}
          >
            {failed
              ? outcome?.summary || 'Edit failed'
              : `${action.edits.length} change${action.edits.length === 1 ? '' : 's'}`}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            openFile(action.path);
            if (breakpoint === 'phone') setActiveIdeTab('code');
          }}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] hover:bg-kalpa-surface text-[11px] text-kalpa-violet shrink-0 cursor-pointer"
        >
          <ExternalLink className="w-3 h-3" />
          Open
        </button>
      </div>

      {expanded ? (
        <div className="p-2 border-t border-kalpa-border bg-kalpa-bg max-h-64 overflow-y-auto space-y-2">
          {outcome?.beforeContent !== undefined && outcome?.afterContent !== undefined ? (
            <DiffView
              path={action.path}
              before={outcome.beforeContent}
              after={outcome.afterContent}
            />
          ) : (
            action.edits.map((pair, idx) => (
              <DiffView
                key={idx}
                path={`${action.path} (hunk ${idx + 1})`}
                before={pair.find}
                after={pair.replace}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
