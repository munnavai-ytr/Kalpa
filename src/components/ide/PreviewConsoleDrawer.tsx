'use client';

import React from 'react';
import { buildFixPromptFromError } from '@/lib/preview/errors';
import { usePreviewStore } from '@/stores/preview';
import { useProjectStore } from '@/stores/project';
import { useChatStore } from '@/stores/chat';
import { useAgentStore } from '@/stores/agent';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';

export function PreviewConsoleDrawer() {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);
  const entries = usePreviewStore((s) => s.entries);
  const clearEntries = usePreviewStore((s) => s.clearEntries);
  const sendUserMessage = useChatStore((s) => s.sendUserMessage);
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);
  const isAgentRunning = useAgentStore((s) => s.isRunning);
  const setActiveIdeTab = useUiStore((s) => s.setActiveIdeTab);

  return (
    <div className="h-44 border-t border-kalpa-border bg-kalpa-bg-2 flex flex-col shrink-0">
      <div className="px-3 py-1.5 border-b border-kalpa-border flex items-center justify-between text-xs">
        <span className="font-semibold text-kalpa-text">Preview Console ({entries.length})</span>
        <button
          type="button"
          onClick={clearEntries}
          className="text-kalpa-muted hover:text-kalpa-text cursor-pointer"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2.5 font-mono text-xs space-y-1.5">
        {entries.length === 0 ? (
          <p className="text-kalpa-muted">No console output yet.</p>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              className={`flex items-start justify-between gap-2 ${
                e.level === 'error'
                  ? 'text-kalpa-danger'
                  : e.level === 'warn'
                    ? 'text-kalpa-warn'
                    : 'text-kalpa-text'
              }`}
            >
              <span className="whitespace-pre-wrap break-all">{e.message}</span>
              {e.level === 'error' ? (
                <button
                  type="button"
                  onClick={() => {
                    const prompt = buildFixPromptFromError(e);
                    if (breakpoint === 'phone') setActiveIdeTab('chat');
                    if (isAgentRunning || !currentProject) {
                      setComposerDraft(prompt);
                    } else {
                      void sendUserMessage(currentProject.id, prompt);
                    }
                  }}
                  className="text-[11px] text-kalpa-violet hover:underline shrink-0 cursor-pointer"
                >
                  Ask AI
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
