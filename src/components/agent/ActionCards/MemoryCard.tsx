'use client';

import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import type { Action } from '@/lib/agent/actions';
import { useAgentStore, type ActionOutcomeMeta } from '@/stores/agent';
import { useBrainStore } from '@/stores/brain';

export interface MemoryCardProps {
  action: Extract<Action, { type: 'memory' }>;
  outcome?: ActionOutcomeMeta;
}

export function MemoryCard({ action, outcome }: MemoryCardProps) {
  const expandDefault = useAgentStore((s) => s.prefs.expandActionCards);
  const [expanded, setExpanded] = useState(expandDefault);
  const setBrainOpen = useBrainStore((s) => s.setBrainOpen);

  const isErr = outcome?.ok === false;

  return (
    <div
      className={`rounded-[10px] border overflow-hidden text-xs ${
        isErr ? 'border-kalpa-danger/40 bg-kalpa-danger/5' : 'border-kalpa-border bg-kalpa-bg-2'
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
          <Brain className="w-3.5 h-3.5 text-kalpa-violet shrink-0" />
          <span className="font-mono text-kalpa-text truncate">
            .kalpa/{action.file}.md
          </span>
          <span className={`font-mono text-[11px] shrink-0 ${isErr ? 'text-kalpa-danger' : 'text-kalpa-muted'}`}>
            {isErr ? outcome?.summary || 'Cap error' : action.op}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setBrainOpen(true)}
          className="text-[11px] text-kalpa-violet hover:underline shrink-0 cursor-pointer"
        >
          Brain
        </button>
      </div>

      {expanded && action.content ? (
        <div className="p-2.5 border-t border-kalpa-border bg-kalpa-bg max-h-56 overflow-y-auto">
          <pre className="text-[11px] font-mono text-kalpa-muted whitespace-pre-wrap break-words m-0">
            {action.content.slice(0, 3000)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
