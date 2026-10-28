'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal } from 'lucide-react';
import type { Action } from '@/lib/agent/actions';
import { useAgentStore, type ActionOutcomeMeta } from '@/stores/agent';

export interface ShellCardProps {
  action: Extract<Action, { type: 'shell' }>;
  outcome?: ActionOutcomeMeta;
}

export function ShellCard({ action, outcome }: ShellCardProps) {
  const expandDefault = useAgentStore((s) => s.prefs.expandActionCards);
  const [expanded, setExpanded] = useState(expandDefault || outcome?.ok === false);

  const exitCode = outcome?.exitCode;
  const isErr = exitCode !== undefined && exitCode !== 0;

  return (
    <div
      className={`rounded-[10px] border overflow-hidden text-xs ${
        isErr ? 'border-kalpa-danger/40 bg-kalpa-danger/5' : 'border-kalpa-border bg-kalpa-bg-2'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-kalpa-muted shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-kalpa-muted shrink-0" />
          )}
          <Terminal className="w-3.5 h-3.5 text-kalpa-violet shrink-0" />
          <span className="font-mono text-kalpa-text truncate">$ {action.cmd}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
          {outcome?.durationMs !== undefined ? (
            <span className="text-kalpa-subtle">{outcome.durationMs}ms</span>
          ) : null}
          {exitCode !== undefined ? (
            <span className={exitCode === 0 ? 'text-kalpa-success' : 'text-kalpa-danger'}>
              exit {exitCode}
            </span>
          ) : (
            <span className="text-kalpa-muted">shell</span>
          )}
        </div>
      </button>

      {expanded && outcome?.output ? (
        <div className="p-2.5 border-t border-kalpa-border bg-kalpa-bg max-h-56 overflow-y-auto">
          <pre className="text-[11px] font-mono text-kalpa-muted whitespace-pre-wrap break-words m-0">
            {outcome.output}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
