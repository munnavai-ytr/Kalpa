'use client';

import React from 'react';
import { Brain, CheckCircle2, Square } from 'lucide-react';
import { parseMilestonesFromTasks } from '@/lib/brain/files';
import { useAgentStore, type AgentStepId } from '@/stores/agent';
import { useBrainStore } from '@/stores/brain';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Spinner } from '@/components/ui/Spinner';

const STEPS: { id: AgentStepId; short: string }[] = [
  { id: 'S0', short: 'Inspect' },
  { id: 'S1', short: 'Brief' },
  { id: 'S2', short: 'Plan' },
  { id: 'S3', short: 'Build' },
  { id: 'S4', short: 'Polish' },
  { id: 'S5', short: 'Verify' },
  { id: 'S6', short: 'Brain' },
  { id: 'S7', short: 'Done' },
];

export function StepTracker() {
  const { breakpoint } = useBreakpoint();
  const isRunning = useAgentStore((s) => s.isRunning);
  const step = useAgentStore((s) => s.step);
  const statusLabel = useAgentStore((s) => s.statusLabel);
  const iteration = useAgentStore((s) => s.iteration);
  const activeNotice = useAgentStore((s) => s.activeNotice);
  const stopTurn = useAgentStore((s) => s.stopTurn);

  const tasksMd = useBrainStore((s) => s.memory.tasks);
  const setBrainOpen = useBrainStore((s) => s.setBrainOpen);
  const milestones = React.useMemo(() => parseMilestonesFromTasks(tasksMd), [tasksMd]);

  if (!isRunning && milestones.total === 0) {
    return null;
  }

  const currentIdx = STEPS.findIndex((s) => s.id === step);

  if (!isRunning) {
    return (
      <div className="px-3 py-2 border-b border-kalpa-border bg-kalpa-bg-2/90 backdrop-blur-sm flex items-center justify-between gap-2 text-xs shrink-0">
        <button
          type="button"
          onClick={() => setBrainOpen(true)}
          className="inline-flex items-center gap-1.5 text-kalpa-muted hover:text-kalpa-text cursor-pointer min-w-0"
        >
          <Brain className="w-3.5 h-3.5 text-kalpa-violet shrink-0" />
          <span className="truncate">
            Milestones: <strong className="text-kalpa-text">{milestones.completed}/{milestones.total}</strong> complete
          </span>
        </button>
        <div className="w-24 h-1.5 rounded-full bg-kalpa-surface overflow-hidden shrink-0">
          <div
            style={{ width: `${Math.round((milestones.completed / Math.max(1, milestones.total)) * 100)}%` }}
            className="h-full bg-kalpa-success transition-all"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-b border-kalpa-border bg-kalpa-bg-2/95 backdrop-blur-md space-y-1.5 shrink-0 z-10">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Spinner size={13} className="text-kalpa-violet shrink-0" />
          <span className="text-xs font-semibold text-kalpa-text truncate">{statusLabel}</span>
          <span className="text-[11px] font-mono text-kalpa-subtle shrink-0">
            {step} · iter {iteration}
          </span>
        </div>

        <button
          type="button"
          onClick={stopTurn}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-[7px] bg-kalpa-danger/15 text-kalpa-danger hover:bg-kalpa-danger/25 text-[11px] font-semibold cursor-pointer shrink-0"
        >
          <Square className="w-2.5 h-2.5 fill-current" />
          Stop
        </button>
      </div>

      {activeNotice ? (
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-[8px] bg-kalpa-warn/15 border border-kalpa-warn/35 text-[11px] font-mono text-kalpa-text">
          <span className="truncate">{activeNotice.text}</span>
          {activeNotice.kind === 'retry_countdown' ? (
            <button
              type="button"
              onClick={stopTurn}
              className="text-kalpa-danger font-semibold hover:underline cursor-pointer shrink-0"
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {breakpoint !== 'phone' ? (
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {STEPS.map((st, idx) => {
            const done = idx < currentIdx;
            const active = idx === currentIdx;
            return (
              <span
                key={st.id}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono whitespace-nowrap ${
                  active
                    ? 'bg-kalpa-violet/20 text-kalpa-violet font-semibold border border-kalpa-violet/40'
                    : done
                      ? 'text-kalpa-success'
                      : 'text-kalpa-subtle'
                }`}
              >
                {done ? <CheckCircle2 className="w-2.5 h-2.5" /> : null}
                {st.short}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
