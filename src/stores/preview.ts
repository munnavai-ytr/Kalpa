'use client';

import { create } from 'zustand';
import { uid } from '@/lib/utils';

export type PreviewStatus = 'idle' | 'building' | 'ready' | 'error' | 'blank' | 'timeout';
export type DeviceFrame = 'desktop' | 'tablet' | 'phone';

export interface PreviewConsoleEntry {
  id: string;
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
  file?: string;
  line?: number;
  time: number;
}

export interface TailwindProbeState {
  ok: boolean;
  runtime: 'v3' | 'v4';
  source: 'self' | 'cdn' | 'failed';
}

interface PreviewStoreState {
  projectId: string | null;
  status: PreviewStatus;
  deviceFrame: DeviceFrame;
  consoleOpen: boolean;
  reloadNonce: number;
  entries: PreviewConsoleEntry[];
  staticBlobUrl: string | null;
  expectedFilesHash: string;
  confirmedFilesHash: string;
  lastReadyFilesHash: string;
  buildStartedAt: number | null;
  rebuildAttemptsByHash: Record<string, number>;
  staleAfterMaxRetries: boolean;
  tailwindProbe: TailwindProbeState | null;

  resetForProject: (projectId: string) => void;
  setStatus: (status: PreviewStatus) => void;
  setDeviceFrame: (frame: DeviceFrame) => void;
  setConsoleOpen: (open: boolean) => void;
  reloadPreview: () => void;
  requestAutoRebuildForHash: (hash: string) => boolean;
  pushEntry: (entry: Omit<PreviewConsoleEntry, 'id' | 'time'>) => void;
  clearEntries: () => void;
  setStaticBlobUrl: (url: string | null) => void;
  setExpectedFilesHash: (hash: string) => void;
  markPreviewReady: (hash: string) => void;
  markPreviewBlank: () => void;
  markPreviewTimeout: () => void;
  setTailwindProbe: (probe: TailwindProbeState | null) => void;
}

export const usePreviewStore = create<PreviewStoreState>((set, get) => ({
  projectId: null,
  status: 'idle',
  deviceFrame: 'desktop',
  consoleOpen: false,
  reloadNonce: 0,
  entries: [],
  staticBlobUrl: null,
  expectedFilesHash: '',
  confirmedFilesHash: '',
  lastReadyFilesHash: '',
  buildStartedAt: null,
  rebuildAttemptsByHash: {},
  staleAfterMaxRetries: false,
  tailwindProbe: null,

  resetForProject: (projectId) =>
    set((s) =>
      s.projectId === projectId
        ? s
        : {
            projectId,
            status: 'idle',
            reloadNonce: 0,
            entries: [],
            staticBlobUrl: null,
            expectedFilesHash: '',
            confirmedFilesHash: '',
            lastReadyFilesHash: '',
            buildStartedAt: null,
            rebuildAttemptsByHash: {},
            staleAfterMaxRetries: false,
            tailwindProbe: null,
          }
    ),

  setStatus: (status) =>
    set((s) => {
      // B2(c): Never set 'building' again for a filesHash already built unless files changed or manual reload cleared confirmedFilesHash
      if (
        status === 'building' &&
        s.expectedFilesHash &&
        s.confirmedFilesHash === s.expectedFilesHash
      ) {
        return s;
      }
      return {
        status,
        buildStartedAt:
          status === 'building'
            ? s.buildStartedAt ?? Date.now()
            : status === 'ready' || status === 'blank' || status === 'timeout'
              ? null
              : s.buildStartedAt,
      };
    }),

  setDeviceFrame: (deviceFrame) => set({ deviceFrame }),
  setConsoleOpen: (consoleOpen) => set({ consoleOpen }),

  reloadPreview: () =>
    set((s) => ({
      reloadNonce: s.reloadNonce + 1,
      entries: [],
      status: 'building',
      confirmedFilesHash: '',
      lastReadyFilesHash: '',
      staleAfterMaxRetries: false,
      tailwindProbe: null,
      buildStartedAt: Date.now(),
    })),

  requestAutoRebuildForHash: (hash) => {
    if (!hash) return false;
    const state = get();
    const used = state.rebuildAttemptsByHash[hash] ?? 0;
    if (used >= 2) {
      set({ staleAfterMaxRetries: true });
      return false;
    }
    set((s) => ({
      rebuildAttemptsByHash: { ...s.rebuildAttemptsByHash, [hash]: used + 1 },
      reloadNonce: s.reloadNonce + 1,
      confirmedFilesHash: '',
      status: 'building',
      buildStartedAt: Date.now(),
    }));
    return true;
  },

  pushEntry: (entry) =>
    set((s) => {
      const next: PreviewConsoleEntry = {
        ...entry,
        id: uid('plog'),
        time: Date.now(),
      };
      return {
        entries: [...s.entries.slice(-199), next],
        status: entry.level === 'error' ? 'error' : s.status,
      };
    }),

  clearEntries: () => set({ entries: [] }),
  setStaticBlobUrl: (staticBlobUrl) => set({ staticBlobUrl }),

  setExpectedFilesHash: (hash) =>
    set((s) => {
      if (s.expectedFilesHash === hash) return s;
      const alreadyBuilt = Boolean(hash && s.lastReadyFilesHash === hash);
      return {
        expectedFilesHash: hash,
        staleAfterMaxRetries: false,
        status: !hash ? 'idle' : alreadyBuilt ? 'ready' : 'building',
        confirmedFilesHash: alreadyBuilt ? hash : s.confirmedFilesHash,
        buildStartedAt: !hash || alreadyBuilt ? null : Date.now(),
      };
    }),

  markPreviewReady: (hash) =>
    set((s) => {
      const resolvedHash = hash || s.expectedFilesHash;
      const hasErrors = s.entries.some((e) => e.level === 'error');
      return {
        confirmedFilesHash: resolvedHash,
        lastReadyFilesHash: resolvedHash,
        staleAfterMaxRetries: false,
        status: hasErrors ? 'error' : s.status === 'blank' ? 'blank' : 'ready',
        buildStartedAt: null,
      };
    }),

  markPreviewBlank: () =>
    set((s) => ({
      status: s.entries.some((e) => e.level === 'error') ? 'error' : 'blank',
      buildStartedAt: null,
    })),

  markPreviewTimeout: () =>
    set((s) => (s.status === 'ready' ? s : { status: 'timeout', buildStartedAt: null })),

  setTailwindProbe: (tailwindProbe) => set({ tailwindProbe }),
}));
