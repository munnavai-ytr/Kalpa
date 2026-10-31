'use client';

import { create } from 'zustand';
import type { Action } from '@/lib/agent/actions';
import type { DoctorIssue } from '@/lib/agent/scaffoldDoctor';
import type { AgentMode } from '@/lib/agent/prompts/system';
import type { RecoveryNotice } from '@/lib/agent/recovery';
import { restoreCheckpoint } from '@/lib/checkpoints/checkpoints';
import { getKalpaDB } from '@/lib/vfs/db';
import { useBrainStore } from './brain';
import { usePreviewStore } from './preview';

export type AgentStepId = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7';
export type ExecutableAction = Exclude<Action, { type: 'text' }>;
export type IdleTimeoutOption = 60000 | 120000 | 300000;

export interface AgentPreferences {
  autoContinue: boolean;
  maxAutoMilestones: number;
  maxRepairAttempts: number;
  expandActionCards: boolean;
  idleTimeoutMs: IdleTimeoutOption;
  keepScreenAwake: boolean;
  economyMode: boolean;
}

export interface ActionOutcomeMeta {
  ok: boolean;
  summary?: string;
  detail?: string;
  beforeContent?: string;
  afterContent?: string;
  exitCode?: number;
  durationMs?: number;
  output?: string;
}

export type LiveStreamItem =
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'action'; action: ExecutableAction; outcome?: ActionOutcomeMeta }
  | { id: string; kind: 'scaffold-doctor'; fixedCount: number; issues: DoctorIssue[] };

export interface PartialActionIndicator {
  tag: string;
  pathHint?: string;
  lineCount: number;
}

export interface PendingAgentQuestion {
  question: string;
  options: string[];
}

interface AgentStoreState {
  prefs: AgentPreferences;
  isRunning: boolean;
  projectId: string | null;
  turnId: string | null;
  mode: AgentMode;
  step: AgentStepId;
  statusLabel: string;
  iteration: number;
  autoMilestoneIndex: number;

  screenAwakeActive: boolean;
  sessionTokensIn: number;
  sessionTokensOut: number;
  activeNotice: RecoveryNotice | null;
  turnNotices: string[];

  liveItems: LiveStreamItem[];
  partialAction: PartialActionIndicator | null;
  pendingQuestion: PendingAgentQuestion | null;

  recentTouchedByProject: Record<string, string[]>;
  summarisedUpToByProject: Record<string, string>;

  hydratePrefs: () => void;
  updatePrefs: (patch: Partial<AgentPreferences>) => void;

  beginTurnUi: (opts: { projectId: string; turnId: string; mode: AgentMode; step: AgentStepId; statusLabel: string }) => void;
  updateTurnStatus: (patch: Partial<{ step: AgentStepId; statusLabel: string; iteration: number; autoMilestoneIndex: number }>) => void;
  setLiveSnapshot: (items: LiveStreamItem[], partial: PartialActionIndicator | null) => void;
  setScreenAwakeActive: (active: boolean) => void;
  addSessionTokens: (input: number, output: number) => void;
  setActiveNotice: (notice: RecoveryNotice | null) => void;
  endTurnUi: () => void;

  recordTouchedPaths: (projectId: string, paths: string[]) => void;
  setSummarisedUpTo: (projectId: string, messageId: string) => void;

  askUserQuestion: (q: PendingAgentQuestion, signal: AbortSignal) => Promise<string>;
  submitQuestionAnswer: (answer: string) => void;

  registerAbortController: (ctrl: AbortController | null) => void;
  stopTurn: () => void;

  undoTurnMessage: (projectId: string, messageId?: string) => Promise<{ ok: boolean; label: string }>;
  redoTurnMessage: (projectId: string, messageId?: string) => Promise<{ ok: boolean; label: string }>;
}

const AGENT_PREFS_KEY = 'kalpa_agent_prefs_v1';

const DEFAULT_PREFS: AgentPreferences = {
  autoContinue: true,
  maxAutoMilestones: 10,
  maxRepairAttempts: 4,
  expandActionCards: false,
  idleTimeoutMs: 120000,
  keepScreenAwake: true,
  economyMode: false,
};

let activeTurnAbort: AbortController | null = null;
let questionResolver: ((answer: string) => void) | null = null;

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  prefs: DEFAULT_PREFS,
  isRunning: false,
  projectId: null,
  turnId: null,
  mode: 'CHANGE',
  step: 'S0',
  statusLabel: 'Idle',
  iteration: 1,
  autoMilestoneIndex: 0,

  screenAwakeActive: false,
  sessionTokensIn: 0,
  sessionTokensOut: 0,
  activeNotice: null,
  turnNotices: [],

  liveItems: [],
  partialAction: null,
  pendingQuestion: null,

  recentTouchedByProject: {},
  summarisedUpToByProject: {},

  hydratePrefs: () => {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(AGENT_PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AgentPreferences>;
        const validIdle: IdleTimeoutOption =
          parsed.idleTimeoutMs === 60000 || parsed.idleTimeoutMs === 300000
            ? parsed.idleTimeoutMs
            : 120000;
        set({
          prefs: {
            autoContinue: parsed.autoContinue ?? DEFAULT_PREFS.autoContinue,
            maxAutoMilestones: Math.max(1, Math.min(30, parsed.maxAutoMilestones ?? 10)),
            maxRepairAttempts: Math.max(1, Math.min(10, parsed.maxRepairAttempts ?? 4)),
            expandActionCards: parsed.expandActionCards ?? false,
            idleTimeoutMs: validIdle,
            keepScreenAwake: parsed.keepScreenAwake ?? true,
            economyMode: parsed.economyMode ?? false,
          },
        });
      }
    } catch {
      // ignore invalid JSON
    }
  },

  updatePrefs: (patch) => {
    const next: AgentPreferences = { ...get().prefs, ...patch };
    set({ prefs: next });
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(AGENT_PREFS_KEY, JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
    }
  },

  beginTurnUi: ({ projectId, turnId, mode, step, statusLabel }) =>
    set({
      isRunning: true,
      projectId,
      turnId,
      mode,
      step,
      statusLabel,
      iteration: 1,
      activeNotice: null,
      turnNotices: [],
      liveItems: [],
      partialAction: null,
      pendingQuestion: null,
    }),

  updateTurnStatus: (patch) => set((s) => ({ ...s, ...patch })),

  setLiveSnapshot: (liveItems, partialAction) => set({ liveItems, partialAction }),

  setScreenAwakeActive: (screenAwakeActive) => set({ screenAwakeActive }),

  addSessionTokens: (input, output) =>
    set((s) => ({
      sessionTokensIn: s.sessionTokensIn + Math.max(0, input || 0),
      sessionTokensOut: s.sessionTokensOut + Math.max(0, output || 0),
    })),

  setActiveNotice: (notice) =>
    set((s) => ({
      activeNotice: notice,
      turnNotices:
        notice?.persistent && !s.turnNotices.includes(notice.text)
          ? [...s.turnNotices, notice.text]
          : s.turnNotices,
    })),

  endTurnUi: () =>
    set({
      isRunning: false,
      turnId: null,
      statusLabel: 'Idle',
      screenAwakeActive: false,
      activeNotice: null,
      turnNotices: [],
      liveItems: [],
      partialAction: null,
      pendingQuestion: null,
      autoMilestoneIndex: 0,
    }),

  recordTouchedPaths: (projectId, paths) => {
    if (paths.length === 0) return;
    set((s) => {
      const prev = s.recentTouchedByProject[projectId] ?? [];
      const merged = Array.from(new Set([...paths, ...prev])).slice(0, 24);
      return { recentTouchedByProject: { ...s.recentTouchedByProject, [projectId]: merged } };
    });
  },

  setSummarisedUpTo: (projectId, messageId) =>
    set((s) => ({
      summarisedUpToByProject: { ...s.summarisedUpToByProject, [projectId]: messageId },
    })),

  askUserQuestion: (q, signal) => {
    set({ pendingQuestion: q, statusLabel: 'Waiting for your answer…' });
    return new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        questionResolver = null;
        set({ pendingQuestion: null });
        reject(new Error('Turn stopped'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      questionResolver = (ans: string) => {
        signal.removeEventListener('abort', onAbort);
        questionResolver = null;
        set({ pendingQuestion: null });
        resolve(ans);
      };
    });
  },

  submitQuestionAnswer: (answer) => {
    const trimmed = answer.trim();
    if (!trimmed || !questionResolver) return;
    questionResolver(trimmed);
  },

  registerAbortController: (ctrl) => {
    activeTurnAbort = ctrl;
  },

  stopTurn: () => {
    if (activeTurnAbort) {
      activeTurnAbort.abort();
      activeTurnAbort = null;
    }
    if (questionResolver) {
      questionResolver = null;
    }
    set({
      isRunning: false,
      screenAwakeActive: false,
      activeNotice: null,
      pendingQuestion: null,
      partialAction: null,
      statusLabel: 'Stopped',
    });
  },

  undoTurnMessage: async (projectId, messageId) => {
    const db = await getKalpaDB();
    const rows = await db.getAllFromIndex('chat', 'by-project', projectId);
    rows.sort((a, b) => b.createdAt - a.createdAt);
    const target = messageId
      ? rows.find((m) => m.id === messageId)
      : rows.find((m) => m.role === 'assistant' && m.meta?.beforeCheckpointId);
    const cpId = target?.meta?.beforeCheckpointId;
    if (!target || !cpId) return { ok: false, label: 'No undoable turn checkpoint found.' };
    const { backupCheckpoint } = await restoreCheckpoint(cpId);
    if (backupCheckpoint) {
      target.meta = { ...target.meta, redoCheckpointId: backupCheckpoint.id };
      await db.put('chat', target);
    }
    await useBrainStore.getState().refreshBrainFromVfs(projectId);
    usePreviewStore.getState().setScaffoldTailwindNote(projectId, false);
    usePreviewStore.getState().reloadPreview();
    return { ok: true, label: 'Reverted project files to before that turn.' };
  },

  redoTurnMessage: async (projectId, messageId) => {
    const db = await getKalpaDB();
    const rows = await db.getAllFromIndex('chat', 'by-project', projectId);
    rows.sort((a, b) => b.createdAt - a.createdAt);
    const target = messageId
      ? rows.find((m) => m.id === messageId)
      : rows.find((m) => m.role === 'assistant' && m.meta?.redoCheckpointId);
    const redoCpId = target?.meta?.redoCheckpointId;
    if (!target || !redoCpId) return { ok: false, label: 'Nothing to redo yet.' };
    await restoreCheckpoint(redoCpId, { skipBeforeBackup: true });
    target.meta = { ...target.meta, redoCheckpointId: undefined };
    await db.put('chat', target);
    await useBrainStore.getState().refreshBrainFromVfs(projectId);
    usePreviewStore.getState().reloadPreview();
    return { ok: true, label: 'Re-applied turn changes.' };
  },
}));
