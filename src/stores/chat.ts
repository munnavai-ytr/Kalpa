'use client';

import { create } from 'zustand';
import { getKalpaDB, type ChatRecord } from '@/lib/vfs/db';
import { vfs } from '@/lib/vfs/vfs';
import type { ChatMessage } from '@/lib/providers/core';
import { useProviderStore } from '@/lib/providers/store';
import { APP_NAME } from '@/lib/brand';
import { uid } from '@/lib/utils';
import { runTurn } from '@/lib/agent/orchestrator';
import { buildContinueMessage } from '@/lib/agent/prompts/system';
import { streamWithRecovery, TerminalProviderError } from '@/lib/agent/recovery';
import { parseMilestonesFromTasks, readAllBrainMemory } from '@/lib/brain/files';
import { useAgentStore } from './agent';
import { useBrainStore } from './brain';
import { useUiStore } from './ui';

interface ChatStoreState {
  projectId: string | null;
  messages: ChatRecord[];
  streamingText: string;
  isStreaming: boolean;
  composerDraft: string;

  loadChat: (projectId: string) => Promise<ChatRecord[]>;
  setComposerDraft: (draft: string) => void;
  sendUserMessage: (projectId: string, text: string) => Promise<void>;
  runInitialProjectTurn: (projectId: string, initialPrompt: string, hasPersistedUserMsg?: boolean) => Promise<void>;
  streamPlainChatReply: (projectId: string, text: string) => Promise<void>;
  stopStreaming: () => void;
  regenerateLast: (projectId: string) => Promise<void>;
  clearChat: (projectId: string) => Promise<void>;
}

let plainChatAbort: AbortController | null = null;

function buildPlainChatSystemPrompt(filePaths: string[]): string {
  const listed =
    filePaths.length > 0
      ? `Current project files:\n${filePaths.slice(0, 180).map((p) => `- ${p}`).join('\n')}`
      : 'The project currently has no files.';
  return [
    `You are ${APP_NAME}, a helpful full-stack coding assistant inside a browser IDE.`,
    'This is a /chat conversation-only turn: answer clearly in plain Markdown without emitting XML action tags.',
    listed,
  ].join('\n\n');
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

  sendUserMessage: async (projectId, rawText) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    if (get().isStreaming || useAgentStore.getState().isRunning) return;

    if (trimmed === '/brain') {
      useBrainStore.getState().setBrainOpen(true);
      return;
    }

    if (trimmed === '/clear') {
      await get().clearChat(projectId);
      useUiStore.getState().addToast({
        title: 'Chat history cleared',
        description: 'Project files, Brain memory, and Checkpoints were kept intact.',
        kind: 'info',
      });
      return;
    }

    if (trimmed === '/undo') {
      const res = await useAgentStore.getState().undoTurnMessage(projectId);
      await get().loadChat(projectId);
      useUiStore.getState().addToast({ title: res.label, kind: res.ok ? 'success' : 'warn' });
      return;
    }

    if (trimmed === '/redo') {
      const res = await useAgentStore.getState().redoTurnMessage(projectId);
      await get().loadChat(projectId);
      useUiStore.getState().addToast({ title: res.label, kind: res.ok ? 'success' : 'warn' });
      return;
    }

    if (trimmed === '/continue' || trimmed.startsWith('/continue ')) {
      const extra = trimmed.slice('/continue'.length).trim();
      const mem = await readAllBrainMemory(projectId);
      const parsed = parseMilestonesFromTasks(mem.tasks);
      const nextItem = parsed.items.find((i) => !i.done);
      const targetId = extra || nextItem?.id || 'next milestone';
      await runTurn(projectId, buildContinueMessage(targetId), {
        mode: 'CONTINUE',
        onMessagesChanged: (msgs) => set({ messages: msgs }),
      });
      return;
    }

    if (trimmed === '/plan' || trimmed.startsWith('/plan ')) {
      const idea =
        trimmed.slice('/plan'.length).trim() ||
        'Review the project and create or refine the milestone plan in Brain memory without editing code.';
      await runTurn(projectId, idea, {
        mode: 'PLAN',
        onMessagesChanged: (msgs) => set({ messages: msgs }),
      });
      return;
    }

    if (trimmed === '/chat' || trimmed.startsWith('/chat ')) {
      const msg = trimmed.slice('/chat'.length).trim();
      if (!msg) {
        useUiStore.getState().addToast({
          title: 'Usage: /chat <your question>',
          description: 'Starts a plain conversation turn without file actions.',
          kind: 'info',
        });
        return;
      }
      await get().streamPlainChatReply(projectId, msg);
      return;
    }

    await runTurn(projectId, trimmed, {
      onMessagesChanged: (msgs) => set({ messages: msgs }),
    });
  },

  runInitialProjectTurn: async (projectId, initialPrompt, hasPersistedUserMsg = true) => {
    await runTurn(projectId, initialPrompt, {
      mode: 'NEW_PROJECT',
      skipAddingUserMessage: hasPersistedUserMsg,
      onMessagesChanged: (msgs) => set({ messages: msgs }),
    });
  },

  streamPlainChatReply: async (projectId, text) => {
    const db = await getKalpaDB();
    const userMsg: ChatRecord = {
      id: uid('msg'),
      projectId,
      role: 'user',
      content: `/chat ${text}`,
      createdAt: Date.now(),
      meta: { plainChat: true },
    };
    await db.put('chat', userMsg);
    const history = [...get().messages, userMsg];
    set({ messages: history });

    let activeProfile = useProviderStore.getState().getActiveProfile();
    if (!activeProfile || (!activeProfile.apiKey && !/localhost|127\.0\.0\.1/.test(activeProfile.baseUrl))) {
      const errMsg: ChatRecord = {
        id: uid('msg'),
        projectId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        meta: {
          plainChat: true,
          error: {
            kind: 'auth',
            message: 'No active provider API key configured.',
            hint: 'Add a key via the model switcher or Settings -> Providers.',
          },
        },
      };
      await db.put('chat', errMsg);
      set({ messages: [...history, errMsg] });
      return;
    }

    const fileMetas = await vfs.list(projectId);
    const paths = fileMetas.map((f) => f.path).filter((p) => !p.startsWith('.kalpa/') && !p.endsWith('/.gitkeep'));
    const apiMessages: ChatMessage[] = [
      { role: 'system', content: buildPlainChatSystemPrompt(paths) },
      ...history
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content })),
    ];

    const controller = new AbortController();
    plainChatAbort = controller;
    set({ isStreaming: true, streamingText: '' });

    let fullText = '';
    let usage: { input?: number; output?: number } | undefined;
    let rafPending = false;
    const { prefs } = useAgentStore.getState();

    const flushUi = () => {
      rafPending = false;
      if (get().isStreaming) set({ streamingText: fullText });
    };

    try {
      for await (const ev of streamWithRecovery(activeProfile, apiMessages, {
        signal: controller.signal,
        idleTimeoutMs: prefs.idleTimeoutMs,
        economyOverride: prefs.economyMode,
        onProfileSwitched: (next) => { activeProfile = next; },
      })) {
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
          useAgentStore.getState().addSessionTokens(ev.usage.input ?? 0, ev.usage.output ?? 0);
        }
      }

      const assistantRecord: ChatRecord = {
        id: uid('msg'),
        projectId,
        role: 'assistant',
        content: fullText || '(empty response)',
        createdAt: Date.now(),
        meta: {
          plainChat: true,
          usage,
          model: activeProfile.model,
          providerLabel: activeProfile.label,
        },
      };
      await db.put('chat', assistantRecord);
      set((s) => ({
        messages: [...s.messages, assistantRecord],
        isStreaming: false,
        streamingText: '',
      }));
    } catch (err) {
      if (!controller.signal.aborted) {
        const errMeta: NonNullable<ChatRecord['meta']>['error'] =
          err instanceof TerminalProviderError
            ? {
                message: err.classified.message,
                hint: err.classified.hint,
                kind: err.classified.kind,
                status: err.status,
                rawDetail: err.rawDetail,
                suggestProxy: err.suggestProxy,
                providerKind: err.profile.kind,
                baseUrl: err.profile.baseUrl,
              }
            : {
                message: err instanceof Error ? err.message : String(err),
                providerKind: activeProfile.kind,
                baseUrl: activeProfile.baseUrl,
              };
        const errRecord: ChatRecord = {
          id: uid('msg'),
          projectId,
          role: 'assistant',
          content: fullText,
          createdAt: Date.now(),
          meta: {
            plainChat: true,
            error: errMeta,
            model: activeProfile.model,
            providerLabel: activeProfile.label,
          },
        };
        await db.put('chat', errRecord);
        set((s) => ({
          messages: [...s.messages, errRecord],
          isStreaming: false,
          streamingText: '',
        }));
      } else {
        set({ isStreaming: false, streamingText: '' });
      }
    } finally {
      if (plainChatAbort === controller) plainChatAbort = null;
    }
  },

  stopStreaming: () => {
    if (plainChatAbort) {
      plainChatAbort.abort();
      plainChatAbort = null;
    }
    useAgentStore.getState().stopTurn();
  },

  regenerateLast: async (projectId) => {
    if (get().isStreaming || useAgentStore.getState().isRunning) return;
    const msgs = [...get().messages];
    if (msgs.length === 0) return;
    const db = await getKalpaDB();

    while (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
      const removed = msgs.pop()!;
      await db.delete('chat', removed.id);
    }
    if (msgs.length === 0) {
      set({ messages: [] });
      return;
    }
    const lastUser = msgs[msgs.length - 1];
    set({ messages: msgs });
    await runTurn(projectId, lastUser.content, {
      skipAddingUserMessage: true,
      onMessagesChanged: (updated) => set({ messages: updated }),
    });
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
