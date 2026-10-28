'use client';

import { create } from 'zustand';
import { uid } from '@/lib/utils';

export type PreviewStatus = 'idle' | 'building' | 'ready' | 'error';
export type DeviceFrame = 'desktop' | 'tablet' | 'phone';

export interface PreviewConsoleEntry {
  id: string;
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
  file?: string;
  line?: number;
  time: number;
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
  buildStartedAt: number | null;

  resetForProject: (projectId: string) => void;
  setStatus: (status: PreviewStatus) => void;
  setDeviceFrame: (frame: DeviceFrame) => void;
  setConsoleOpen: (open: boolean) => void;
  reloadPreview: () => void;
  pushEntry: (entry: Omit<PreviewConsoleEntry, 'id' | 'time'>) => void;
  clearEntries: () => void;
  setStaticBlobUrl: (url: string | null) => void;
  setExpectedFilesHash: (hash: string) => void;
  markPreviewReady: (hash: string) => void;
}

export const usePreviewStore = create<PreviewStoreState>((set) => ({
  projectId: null,
  status: 'idle',
  deviceFrame: 'desktop',
  consoleOpen: false,
  reloadNonce: 0,
  entries: [],
  staticBlobUrl: null,
  expectedFilesHash: '',
  confirmedFilesHash: '',
  buildStartedAt: null,

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
            buildStartedAt: null,
          }
    ),

  setStatus: (status) =>
    set((s) => ({
      status,
      buildStartedAt:
        status === 'building' ? s.buildStartedAt ?? Date.now() : status === 'ready' ? null : s.buildStartedAt,
    })),

  setDeviceFrame: (deviceFrame) => set({ deviceFrame }),
  setConsoleOpen: (consoleOpen) => set({ consoleOpen }),

  reloadPreview: () =>
    set((s) => ({
      reloadNonce: s.reloadNonce + 1,
      entries: [],
      status: 'building',
      confirmedFilesHash: '',
      buildStartedAt: Date.now(),
    })),

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
      return {
        expectedFilesHash: hash,
        buildStartedAt: hash ? Date.now() : null,
      };
    }),

  markPreviewReady: (hash) =>
    set((s) => ({
      confirmedFilesHash: hash || s.expectedFilesHash,
      status: s.entries.some((e) => e.level === 'error') ? s.status : 'ready',
      buildStartedAt: null,
    })),
}));
