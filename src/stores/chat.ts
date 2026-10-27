'use client';

import { create } from 'zustand';
import { getKalpaDB, type ChatRecord } from '@/lib/vfs/db';
import { vfs } from '@/lib/vfs/vfs';
import { streamChat, type ChatMessage } from '@/lib/providers/core';
import { useProviderStore } from '@/lib/providers/store';
import { APP_NAME } from '@/lib/brand';
import { uid } from '@/lib/utils';

interface ChatStoreState {
  projectId: string | null;
  messages: ChatRecord[];
  streamingText: string;
  isStreaming: boolean;
  composerDraft: string;

  loadChat: (projectId: string) => Promise<ChatRecord[]>;
  setComposerDraft: (draft: string) => void;
  sendUserMessage: (projectId: string, text: string) => Promise<void>;
  streamReplyForHistory: (projectId: string, history: ChatRecord[]) => Promise<void>;
  stopStreaming: () => void;
  regenerateLast: (projectId: string) => Promise<void>;
  clearChat: (projectId: string) => Promise<void>;
}

let activeAbort: AbortController | null = null;

function buildSystemPrompt(filePaths: string[]): string {
  const listed =
    filePaths.length > 0
      ? `Current project files:\n${filePaths.slice(0, 180).map((p) => `- ${p}`).join('\n')}`
      : 'The project currently has no files.';
  return [
    `You are ${APP_NAME}, a helpful full-stack coding assistant inside a browser IDE.`,
    'When providing complete file code blocks, place a file path comment on the very first line inside the fenced code block (for example `// src/App.tsx`, `# main.py`, or `<!-- index.html -->`) so the user can insert it directly into their project with one click.',
    listed,
  ].join('\n\n');
}

function classifyStreamError(err: unknown, baseUrl: string, usingProxy: boolean): {
  message: string;
  status?: number;
  suggestProxy: boolean;
} {
  const raw = err instanceof Error ? err.message : String(err);
  const statusMatch = raw.match(/^(\d{3})\b/);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  const isLocal = /localhost|127\.0\.0\.1/.test(baseUrl);
  const isCors = !usingProxy && !isLocal && /failed to fetch|networkerror|load failed|cors/i.test(raw);

  if (status === 401 || status === 403) {
    return {
      message: `Authentication failed (${status}). Check your API key in Settings.`,
      status,
      suggestProxy: false,
    };
  }
  if (status === 429) {
    return {
      message: 'Rate limit or quota reached (429). Wait a moment or switch models.',
      status,
      suggestProxy: false,
    };
  }
  if (/context_length|maximum context|too many tokens|prompt is too long/i.test(raw)) {
    return {
      message: 'Conversation exceeds model context window. Clear chat or switch to a larger-context model.',
      status,
      suggestProxy: false,
    };
  }
  if (isCors) {
    return {
      message: 'Network or CORS error reaching provider directly from browser.',
      suggestProxy: true,
    };
  }
  return { message: raw, status, suggestProxy: false };
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  projectId: null,
  messages: [],
  streamingText: '',
  isStreaming: false,
  composerDraft: '',

  loadChat: async (projectId) => {
    const db = await getKalpaDB();
    const rows = await db.getAllFromIndex('chat', 'by-project', projectId);
    rows.sort((a, b) => a.createdAt - b.createdAt);
    set({ projectId, messages: rows, streamingText: '' });
    return rows;
  },

  setComposerDraft: (composerDraft) => set({ composerDraft }),

  /** Single entry point for sending a user message (Prompt 2 replaces with agent orchestrator). */
  sendUserMessage: async (projectId, text) => {
    const trimmed = text.trim();
    if (!trimmed || get().isStreaming) return;

    const db = await getKalpaDB();
    const userMsg: ChatRecord = {
      id: uid('msg'),
      projectId,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };
    await db.put('chat', userMsg);
    const nextHistory = [...get().messages, userMsg];
    set({ messages: nextHistory });

    await get().streamReplyForHistory(projectId, nextHistory);
  },

  streamReplyForHistory: async (projectId, history) => {
    const profile = useProviderStore.getState().getActiveProfile();
    const db = await getKalpaDB();

    if (!profile || (!profile.apiKey && !/localhost|127\.0\.0\.1/.test(profile.baseUrl))) {
      const errMsg: ChatRecord = {
        id: uid('msg'),
        projectId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        meta: {
          error: {
            message: 'No active provider API key configured. Add a key via the model switcher or Settings.',
          },
        },
      };
      await db.put('chat', errMsg);
      set({ messages: [...history, errMsg] });
      return;
    }

    const fileMetas = await vfs.list(projectId);
    const paths = fileMetas.map((f) => f.path).filter((p) => !p.endsWith('/.gitkeep'));
    const apiMessages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(paths) },
      ...history
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content })),
    ];

    const controller = new AbortController();
    activeAbort = controller;
    set({ isStreaming: true, streamingText: '' });

    let fullText = '';
    let usage: { input?: number; output?: number } | undefined;
    let rafPending = false;

    const flushUi = () => {
      rafPending = false;
      if (get().isStreaming) {
        set({ streamingText: fullText });
      }
    };

    try {
      for await (const ev of streamChat(profile, apiMessages, controller.signal)) {
        if (ev.delta) {
          fullText += ev.delta;
          if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(flushUi);
          }
        }
        if (ev.usage) {
          usage = {
            input: ev.usage.input ?? usage?.input,
            output: ev.usage.output ?? usage?.output,
          };
        }
      }

      const assistantRecord: ChatRecord = {
        id: uid('msg'),
        projectId,
        role: 'assistant',
        content: fullText || '(empty response)',
        createdAt: Date.now(),
        meta: {
          usage,
          model: profile.model,
          providerLabel: profile.label,
        },
      };
      await db.put('chat', assistantRecord);
      set((s) => ({
        messages: [...s.messages, assistantRecord],
        isStreaming: false,
        streamingText: '',
      }));
    } catch (err) {
      if (controller.signal.aborted) {
        if (fullText.trim()) {
          const partial: ChatRecord = {
            id: uid('msg'),
            projectId,
            role: 'assistant',
            content: `${fullText}\n\n*(Stopped)*`,
            createdAt: Date.now(),
            meta: { usage, model: profile.model, providerLabel: profile.label },
          };
          await db.put('chat', partial);
          set((s) => ({
            messages: [...s.messages, partial],
            isStreaming: false,
            streamingText: '',
          }));
        } else {
          set({ isStreaming: false, streamingText: '' });
        }
        return;
      }

      const classified = classifyStreamError(err, profile.baseUrl, profile.useProxy);
      const errRecord: ChatRecord = {
        id: uid('msg'),
        projectId,
        role: 'assistant',
        content: fullText,
        createdAt: Date.now(),
        meta: {
          error: classified,
          model: profile.model,
          providerLabel: profile.label,
        },
      };
      await db.put('chat', errRecord);
      set((s) => ({
        messages: [...s.messages, errRecord],
        isStreaming: false,
        streamingText: '',
      }));
    } finally {
      if (activeAbort === controller) activeAbort = null;
    }
  },

  stopStreaming: () => {
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
    }
  },

  regenerateLast: async (projectId) => {
    if (get().isStreaming) return;
    const msgs = [...get().messages];
    if (msgs.length === 0) return;
    const db = await getKalpaDB();

    // Remove trailing assistant message(s) so we re-run from the last user turn
    while (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
      const removed = msgs.pop()!;
      await db.delete('chat', removed.id);
    }
    if (msgs.length === 0) {
      set({ messages: [] });
      return;
    }
    set({ messages: msgs });
    await get().streamReplyForHistory(projectId, msgs);
  },

  clearChat: async (projectId) => {
    get().stopStreaming();
    const db = await getKalpaDB();
    const keys = await db.getAllKeysFromIndex('chat', 'by-project', projectId);
    const tx = db.transaction('chat', 'readwrite');
    for (const k of keys) {
      await tx.store.delete(k);
    }
    await tx.done;
    set({ messages: [], streamingText: '', isStreaming: false });
  },
}));
