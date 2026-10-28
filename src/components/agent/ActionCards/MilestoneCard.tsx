'use client';

import React from 'react';
import { CheckCircle2, Info, Play } from 'lucide-react';
import type { Action } from '@/lib/agent/actions';
import { parseMilestonesFromTasks } from '@/lib/brain/files';
import { useAgentStore } from '@/stores/agent';
import { useBrainStore } from '@/stores/brain';
import { useChatStore } from '@/stores/chat';
import { useProjectStore } from '@/stores/project';
import { Button } from '@/components/ui/Button';

export interface MilestoneCardProps {
  action: Extract<Action, { type: 'complete' | 'finished' }>;
  filesChangedCount?: number;
}

export function MilestoneCard({ action, filesChangedCount }: MilestoneCardProps) {
  const currentProject = useProjectStore((s) => s.currentProject);
  const isRunning = useAgentStore((s) => s.isRunning);
  const autoContinue = useAgentStore((s) => s.prefs.autoContinue);
  const tasksMd = useBrainStore((s) => s.memory.tasks);
  const sendUserMessage = useChatStore((s) => s.sendUserMessage);

  const parsed = React.useMemo(() => parseMilestonesFromTasks(tasksMd), [tasksMd]);

  // B5: Never render a green success card when 0 files were changed in the turn
  if (filesChangedCount === 0) {
    return (
      <div className="rounded-[10px] border border-kalpa-border bg-kalpa-surface/70 px-3 py-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-kalpa-muted font-mono">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>0 files changed</span>
        </div>
        {parsed.total > 0 ? (
          <span className="font-mono text-[11px] text-kalpa-subtle">
            {parsed.completed}/{parsed.total} milestones
          </span>
        ) : null}
      </div>
    );
  }

  if (action.type === 'finished') {
    return (
      <div className="rounded-[10px] border border-kalpa-success/35 bg-kalpa-success/10 px-3 py-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-kalpa-success font-medium">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Turn complete</span>
        </div>
        {parsed.total > 0 ? (
          <span className="font-mono text-[11px] text-kalpa-muted">
            {parsed.completed}/{parsed.total} milestones
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-kalpa-success/40 bg-kalpa-success/10 px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <CheckCircle2 className="w-4 h-4 text-kalpa-success shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold text-kalpa-text truncate">
            Milestone {action.milestone} complete
          </p>
          <p className="text-[11px] text-kalpa-muted">
            {parsed.total > 0 ? `${parsed.completed}/${parsed.total} done` : 'Verified'}
            {action.next ? ` · Next: ${action.next}` : ''}
          </p>
        </div>
      </div>

      {action.next && !autoContinue && !isRunning && currentProject ? (
        <Button
          size="sm"
          variant="primary"
          leftIcon={<Play className="w-3 h-3" />}
          onClick={() => sendUserMessage(currentProject.id, `/continue ${action.next}`)}
        >
          Continue {action.next}
        </Button>
      ) : null}
    </div>
  );
}
