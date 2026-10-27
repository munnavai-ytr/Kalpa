'use client';

import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, Send, Square, Trash2 } from 'lucide-react';
import { vfs } from '@/lib/vfs/vfs';
import { useProviderStore } from '@/lib/providers/store';
import { useChatStore } from '@/stores/chat';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { IconButton } from '@/components/ui/IconButton';
import { ChatMessageRow } from './ChatMessageRow';

export function ChatPanel() {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);
  const openFile = useProjectStore((s) => s.openFile);

  const messages = useChatStore((s) => s.messages);
  const streamingText = useChatStore((s) => s.streamingText);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const composerDraft = useChatStore((s) => s.composerDraft);
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);
  const sendUserMessage = useChatStore((s) => s.sendUserMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const regenerateLast = useChatStore((s) => s.regenerateLast);
  const clearChat = useChatStore((s) => s.clearChat);

  const getActiveProfile = useProviderStore((s) => s.getActiveProfile);
  const upsertProfile = useProviderStore((s) => s.upsertProfile);
  const addToast = useUiStore((s) => s.addToast);
  const setActiveIdeTab = useUiStore((s) => s.setActiveIdeTab);

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [extraLoaded, setExtraLoaded] = useState(0);
  const windowStart =
    messages.length > 200 ? Math.max(0, messages.length - (150 + extraLoaded)) : 0;

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streamingText]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(180, el.scrollHeight)}px`;
  }, [composerDraft]);

  const handleInsertFile = async (path: string, content: string) => {
    if (!currentProject) return;
    await vfs.write(currentProject.id, path, content);
    openFile(path);
    if (breakpoint === 'phone') setActiveIdeTab('code');
    addToast({ title: `Saved ${path}`, kind: 'success' });
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!currentProject || !composerDraft.trim() || isStreaming) return;
    const text = composerDraft;
    setComposerDraft('');
    await sendUserMessage(currentProject.id, text);
  };

  const handleEnableProxyAndRetry = async () => {
    if (!currentProject) return;
    const active = getActiveProfile();
    if (active) {
      await upsertProfile({ ...active, useProxy: true });
    }
    await regenerateLast(currentProject.id);
  };

  const visibleMessages = messages.slice(windowStart);

  return (
    <div className="h-full flex flex-col bg-kalpa-bg">
      <div className="h-11 px-3 border-b border-kalpa-border bg-kalpa-bg-2 flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-kalpa-text">Chat</span>
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Regenerate last response"
            size="sm"
            disabled={isStreaming || messages.length === 0}
            onClick={() => currentProject && regenerateLast(currentProject.id)}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton
            label="Clear chat"
            size="sm"
            disabled={isStreaming || messages.length === 0}
            onClick={() => currentProject && clearChat(currentProject.id)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </IconButton>
        </div>
      </div>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-4">
        {windowStart > 0 ? (
          <button
            type="button"
            onClick={() => setExtraLoaded((prev) => prev + 100)}
            className="w-full py-2 text-xs text-kalpa-muted hover:text-kalpa-text border border-kalpa-border rounded-[10px] cursor-pointer"
          >
            Load {windowStart} earlier messages
          </button>
        ) : null}

        {messages.length === 0 && !isStreaming ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-kalpa-muted space-y-1.5">
            <p className="text-sm font-medium text-kalpa-text">Ask anything about your project</p>
            <p className="text-xs max-w-xs">
              Streaming BYOK chat is connected. Full autonomous file editing &amp; checkpoints arrive in Prompt 2.
            </p>
          </div>
        ) : null}

        {visibleMessages.map((msg) => (
          <ChatMessageRow
            key={msg.id}
            msg={msg}
            onInsertFile={handleInsertFile}
            onRetry={() => currentProject && regenerateLast(currentProject.id)}
            onEnableProxyAndRetry={handleEnableProxyAndRetry}
          />
        ))}

        {isStreaming ? (
          <div className="pr-2">
            <div className="rounded-[14px] p-3.5 text-sm leading-relaxed bg-kalpa-bg-2 border border-kalpa-violet/40 text-kalpa-text whitespace-pre-wrap break-words">
              {streamingText || 'Thinking…'}
            </div>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleSend}
        className="p-2.5 border-t border-kalpa-border bg-kalpa-bg-2 shrink-0"
      >
        <div className="flex items-end gap-2 rounded-[14px] bg-kalpa-surface border border-kalpa-border p-2 focus-within:border-kalpa-violet">
          <textarea
            ref={textareaRef}
            rows={1}
            value={composerDraft}
            onChange={(e) => setComposerDraft(e.target.value)}
            onKeyDown={(e) => {
              if (breakpoint !== 'phone' && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Message Kalpa…"
            aria-label="Chat message input"
            className="flex-1 resize-none bg-transparent px-1.5 py-1.5 text-base sm:text-sm text-kalpa-text placeholder:text-kalpa-muted focus:outline-none max-h-44"
          />
          {isStreaming ? (
            <IconButton
              label="Stop generation"
              onClick={stopStreaming}
              className="bg-kalpa-danger/20 text-kalpa-danger"
            >
              <Square className="w-4 h-4 fill-current" />
            </IconButton>
          ) : (
            <IconButton
              type="submit"
              label="Send message"
              disabled={!composerDraft.trim()}
              className="kalpa-grad-bg text-white disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </IconButton>
          )}
        </div>
      </form>
    </div>
  );
}
