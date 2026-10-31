'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain,
  FastForward,
  RotateCcw,
  Send,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { useProviderStore } from '@/lib/providers/store';
import { useAgentStore } from '@/stores/agent';
import { useBrainStore } from '@/stores/brain';
import { useChatStore } from '@/stores/chat';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { ModelChip } from '@/components/ide/ModelChip';
import { IconButton } from '@/components/ui/IconButton';
import { StepTracker } from './StepTracker';
import { LiveStreamingMessage, SavedMessage } from './Message';

const SLASH_COMMANDS = [
  { cmd: '/continue', desc: 'Execute the next unchecked milestone in tasks.md' },
  { cmd: '/plan ', desc: 'Create or update Brain plan & milestones without editing code' },
  { cmd: '/undo', desc: 'Revert workspace files to before the last turn' },
  { cmd: '/redo', desc: 'Re-apply the most recently undone turn' },
  { cmd: '/brain', desc: 'Open Project Brain (.kalpa memory & file index)' },
  { cmd: '/chat ', desc: 'Normal conversation turn without file actions' },
  { cmd: '/clear', desc: 'Clear chat messages (keeps files, Brain & checkpoints)' },
];

const EXAMPLE_PROMPTS = [
  'Build a personal expense tracker with category budgets, search, and visual summary bars',
  'Create an interactive Pomodoro focus timer with customizable tasks and session stats',
  'Build a Markdown study notes workspace with tags, live preview, and local persistence',
  'Write a clean Python data analyzer script with sample CSV stats and table output',
];

function formatCompactTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function ChatPanel() {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);

  const messages = useChatStore((s) => s.messages);
  const streamingText = useChatStore((s) => s.streamingText);
  const isPlainStreaming = useChatStore((s) => s.isStreaming);
  const composerDraft = useChatStore((s) => s.composerDraft);
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);
  const sendUserMessage = useChatStore((s) => s.sendUserMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const regenerateLast = useChatStore((s) => s.regenerateLast);
  const clearChat = useChatStore((s) => s.clearChat);
  const loadChat = useChatStore((s) => s.loadChat);

  const isAgentRunning = useAgentStore((s) => s.isRunning);
  const liveItems = useAgentStore((s) => s.liveItems);
  const partialAction = useAgentStore((s) => s.partialAction);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);
  const screenAwakeActive = useAgentStore((s) => s.screenAwakeActive);
  const sessionTokensIn = useAgentStore((s) => s.sessionTokensIn);
  const sessionTokensOut = useAgentStore((s) => s.sessionTokensOut);
  const autoContinue = useAgentStore((s) => s.prefs.autoContinue);
  const updatePrefs = useAgentStore((s) => s.updatePrefs);

  const setBrainOpen = useBrainStore((s) => s.setBrainOpen);
  const setModelSheetOpen = useUiStore((s) => s.setModelSheetOpen);

  const profiles = useProviderStore((s) => s.profiles);
  const activeProfileId = useProviderStore((s) => s.activeProfileId);
  const upsertProfile = useProviderStore((s) => s.upsertProfile);
  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [extraLoaded, setExtraLoaded] = useState(0);

  const busy = isAgentRunning || isPlainStreaming;
  const windowStart =
    messages.length > 160 ? Math.max(0, messages.length - (120 + extraLoaded)) : 0;
  const visibleMessages = messages.slice(windowStart);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, liveItems.length, partialAction?.lineCount, streamingText]);

  useEffect(() => {
    if (!currentProject) return;
    const targetPid = currentProject.id;
    const onChatUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<{ projectId?: string }>).detail;
      if (!detail?.projectId || detail.projectId === targetPid) {
        void loadChat(targetPid);
      }
    };
    window.addEventListener('kalpa:chat-updated', onChatUpdated);
    return () => window.removeEventListener('kalpa:chat-updated', onChatUpdated);
  }, [currentProject, loadChat]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(180, el.scrollHeight)}px`;
  }, [composerDraft]);

  const matchingSlash = useMemo(() => {
    if (!composerDraft.startsWith('/') || composerDraft.includes('\n')) return [];
    const token = composerDraft.split(/\s+/)[0].toLowerCase();
    if (composerDraft.includes(' ')) return [];
    return SLASH_COMMANDS.filter((s) => s.cmd.trim().startsWith(token));
  }, [composerDraft]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!currentProject || !composerDraft.trim() || busy) return;
    const text = composerDraft;
    setComposerDraft('');
    await sendUserMessage(currentProject.id, text);
  };

  const handleEnableProxyAndRetry = async () => {
    if (!currentProject || !activeProfile) return;
    await upsertProfile({ ...activeProfile, useProxy: true });
    await regenerateLast(currentProject.id);
  };

  return (
    <div className="h-full flex flex-col bg-kalpa-bg">
      <div className="h-11 px-3 border-b border-kalpa-border bg-kalpa-bg-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-kalpa-violet shrink-0" />
          <span className="text-xs font-semibold text-kalpa-text">Agent</span>
          {screenAwakeActive ? (
            <span
              title="Screen Wake Lock is active while building"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-kalpa-success/15 text-[10px] font-mono text-kalpa-success shrink-0"
            >
              <Smartphone className="w-2.5 h-2.5" />
              screen awake
            </span>
          ) : null}
          {sessionTokensIn > 0 || sessionTokensOut > 0 ? (
            <span
              title={`Session tokens — input: ${sessionTokensIn}, output: ${sessionTokensOut}`}
              className="text-[10px] font-mono text-kalpa-muted tabular-nums truncate"
            >
              {formatCompactTokens(sessionTokensIn)} in / {formatCompactTokens(sessionTokensOut)} out
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <IconButton label="Open Project Brain" size="sm" onClick={() => setBrainOpen(true)}>
            <Brain className="w-3.5 h-3.5 text-kalpa-violet" />
          </IconButton>
          <IconButton
            label="Regenerate last turn"
            size="sm"
            disabled={busy || messages.length === 0}
            onClick={() => currentProject && regenerateLast(currentProject.id)}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton
            label="Clear chat history"
            size="sm"
            disabled={busy || messages.length === 0}
            onClick={() => currentProject && clearChat(currentProject.id)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </IconButton>
        </div>
      </div>

      <StepTracker />

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-4">
        {windowStart > 0 ? (
          <button
            type="button"
            onClick={() => setExtraLoaded((n) => n + 100)}
            className="w-full py-2 text-xs text-kalpa-muted hover:text-kalpa-text border border-kalpa-border rounded-[10px] cursor-pointer"
          >
            Load {windowStart} earlier messages
          </button>
        ) : null}

        {messages.length === 0 && !busy ? (
          <div className="py-6 px-2 space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-kalpa-text">
                Describe what you want to build or change
              </p>
              <p className="text-xs text-kalpa-muted leading-relaxed">
                Kalpa plans milestones in <code className="font-mono">.kalpa/</code>, writes and edits real files, verifies the preview, and saves undoable checkpoints automatically.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-wider text-kalpa-subtle">
                Try an example prompt
              </p>
              <div className="grid grid-cols-1 gap-2">
                {EXAMPLE_PROMPTS.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => currentProject && void sendUserMessage(currentProject.id, ex)}
                    className="text-left p-2.5 rounded-[10px] border border-kalpa-border bg-kalpa-bg-2 hover:border-kalpa-violet/50 hover:bg-kalpa-surface text-xs text-kalpa-text transition-colors cursor-pointer"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {visibleMessages.map((msg) => (
          <SavedMessage
            key={msg.id}
            msg={msg}
            onRetry={() => currentProject && regenerateLast(currentProject.id)}
            onEnableProxyAndRetry={handleEnableProxyAndRetry}
            onSwitchModel={() => setModelSheetOpen(true)}
          />
        ))}

        {isAgentRunning ? (
          <LiveStreamingMessage
            items={liveItems}
            partial={partialAction}
            hasPendingQuestion={Boolean(pendingQuestion)}
          />
        ) : null}

        {isPlainStreaming ? (
          <div className="rounded-[14px] p-3.5 text-sm leading-relaxed bg-kalpa-bg-2 border border-kalpa-violet/40 text-kalpa-text whitespace-pre-wrap break-words">
            {streamingText || 'Thinking…'}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleSend}
        className="relative p-2.5 border-t border-kalpa-border bg-kalpa-bg-2 shrink-0 space-y-2"
      >
        {matchingSlash.length > 0 ? (
          <div className="absolute left-2.5 right-2.5 bottom-full mb-1.5 z-30 rounded-[12px] border border-kalpa-border bg-kalpa-bg-2 shadow-kalpa-soft p-1.5 space-y-0.5">
            {matchingSlash.map((item) => (
              <button
                key={item.cmd}
                type="button"
                onClick={() => {
                  if (!item.cmd.endsWith(' ') && currentProject) {
                    setComposerDraft('');
                    void sendUserMessage(currentProject.id, item.cmd);
                  } else {
                    setComposerDraft(item.cmd);
                    textareaRef.current?.focus();
                  }
                }}
                className="w-full px-2.5 py-2 rounded-[8px] hover:bg-kalpa-surface flex items-center justify-between gap-2 text-left text-xs cursor-pointer"
              >
                <span className="font-mono font-semibold text-kalpa-violet">{item.cmd.trim()}</span>
                <span className="text-kalpa-muted truncate">{item.desc}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2 rounded-[14px] bg-kalpa-surface border border-kalpa-border p-2 focus-within:border-kalpa-violet">
          <textarea
            ref={textareaRef}
            rows={1}
            value={composerDraft}
            onChange={(e) => setComposerDraft(e.target.value)}
            onKeyDown={(e) => {
              if (breakpoint !== 'phone' && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Describe a feature, paste an error, or type / for commands…"
            aria-label="Agent prompt input"
            className="flex-1 resize-none bg-transparent px-1.5 py-1.5 text-base sm:text-sm text-kalpa-text placeholder:text-kalpa-muted focus:outline-none max-h-44"
          />

          {busy ? (
            <IconButton
              label="Stop agent turn"
              onClick={stopStreaming}
              className="bg-kalpa-danger/20 text-kalpa-danger"
            >
              <Square className="w-4 h-4 fill-current" />
            </IconButton>
          ) : (
            <IconButton
              type="submit"
              label="Send prompt"
              disabled={!composerDraft.trim()}
              className="kalpa-grad-bg text-white disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </IconButton>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-0.5 text-[11px]">
          <ModelChip onClick={() => setModelSheetOpen(true)} compact className="max-w-[60%]" />

          <button
            type="button"
            onClick={() => updatePrefs({ autoContinue: !autoContinue })}
            title="Automatically execute subsequent milestones when <complete next='Mx' /> is emitted"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-[7px] font-mono cursor-pointer transition-colors ${
              autoContinue
                ? 'bg-kalpa-success/15 text-kalpa-success'
                : 'bg-kalpa-surface/70 text-kalpa-muted'
            }`}
          >
            <FastForward className="w-3 h-3" />
            Auto-continue: {autoContinue ? 'ON' : 'OFF'}
          </button>
        </div>
      </form>
    </div>
  );
}
