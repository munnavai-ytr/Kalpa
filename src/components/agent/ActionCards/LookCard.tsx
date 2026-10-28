'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Eye, FolderTree, GitFork, Search } from 'lucide-react';
import type { Action } from '@/lib/agent/actions';
import { useAgentStore, type ActionOutcomeMeta } from '@/stores/agent';

export interface LookCardProps {
  action: Extract<Action, { type: 'read' | 'search' | 'list' | 'impact' }>;
  outcome?: ActionOutcomeMeta;
}

export function LookCard({ action, outcome }: LookCardProps) {
  const expandDefault = useAgentStore((s) => s.prefs.expandActionCards);
  const [expanded, setExpanded] = useState(expandDefault);

  let icon = <Eye className="w-3.5 h-3.5 text-kalpa-muted shrink-0" />;
  let label = '';

  if (action.type === 'read') {
    label = `read ${action.path}${action.lines ? ` (${action.lines})` : ''}`;
  } else if (action.type === 'search') {
    icon = <Search className="w-3.5 h-3.5 text-kalpa-muted shrink-0" />;
    label = `search "${action.query}"`;
  } else if (action.type === 'list') {
    icon = <FolderTree className="w-3.5 h-3.5 text-kalpa-muted shrink-0" />;
    label = `list ${action.path} (depth ${action.depth})`;
  } else {
    icon = <GitFork className="w-3.5 h-3.5 text-kalpa-muted shrink-0" />;
    label = `impact ${action.target || action.symbol || ''}`;
  }

  return (
    <div className="rounded-[10px] border border-kalpa-border/75 bg-kalpa-bg-2/70 overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-1.5 flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {expanded && outcome?.detail ? (
            <ChevronDown className="w-3 h-3 text-kalpa-subtle shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-kalpa-subtle shrink-0" />
          )}
          {icon}
          <span className="font-mono text-[11px] text-kalpa-muted truncate">{label}</span>
        </div>
      </button>

      {expanded && outcome?.detail ? (
        <div className="p-2 border-t border-kalpa-border bg-kalpa-bg max-h-48 overflow-y-auto">
          <pre className="text-[11px] font-mono text-kalpa-muted whitespace-pre-wrap break-words m-0">
            {outcome.detail}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
