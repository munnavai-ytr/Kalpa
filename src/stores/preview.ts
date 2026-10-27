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
  status: PreviewStatus;
  deviceFrame: DeviceFrame;
  consoleOpen: boolean;
  reloadNonce: number;
  entries: PreviewConsoleEntry[];
  staticBlobUrl: string | null;

  setStatus: (status: PreviewStatus) => void;
  setDeviceFrame: (frame: DeviceFrame) => void;
  setConsoleOpen: (open: boolean) => void;
  reloadPreview: () => void;
  pushEntry: (entry: Omit<PreviewConsoleEntry, 'id' | 'time'>) => void;
  clearEntries: () => void;
  setStaticBlobUrl: (url: string | null) => void;
}

export const usePreviewStore = create<PreviewStoreState>((set) => ({
  status: 'idle',
  deviceFrame: 'desktop',
  consoleOpen: false,
  reloadNonce: 0,
  entries: [],
  staticBlobUrl: null,

  setStatus: (status) => set({ status }),
  setDeviceFrame: (deviceFrame) => set({ deviceFrame }),
  setConsoleOpen: (consoleOpen) => set({ consoleOpen }),
  reloadPreview: () =>
    set((s) => ({
      reloadNonce: s.reloadNonce + 1,
      entries: [],
      status: 'building',
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
}));
