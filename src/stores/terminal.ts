'use client';

import { create } from 'zustand';

export type TerminalLineKind = 'stdout' | 'stderr' | 'info' | 'system';

export interface TerminalSink {
  write: (data: string) => void;
  writeln: (data: string) => void;
  clear: () => void;
}

export interface TerminalBackend {
  id: string;
  label: string;
  attach: (term: TerminalSink) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  dispose: () => void;
}

type LineSubscriber = (text: string, kind: TerminalLineKind) => void;

const lineSubscribers = new Set<LineSubscriber>();

interface TerminalStoreState {
  activeBackend: TerminalBackend | null;
  ctrlSticky: boolean;
  altSticky: boolean;

  setActiveBackend: (backend: TerminalBackend | null) => void;
  setCtrlSticky: (active: boolean) => void;
  setAltSticky: (active: boolean) => void;
  sendTerminalInput: (raw: string) => void;
  writeLine: (text: string, kind?: TerminalLineKind) => void;
  subscribeLines: (cb: LineSubscriber) => () => void;
}

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
  activeBackend: null,
  ctrlSticky: false,
  altSticky: false,

  setActiveBackend: (activeBackend) => set({ activeBackend }),
  setCtrlSticky: (ctrlSticky) => set({ ctrlSticky }),
  setAltSticky: (altSticky) => set({ altSticky }),

  sendTerminalInput: (raw) => {
    const { activeBackend, ctrlSticky, altSticky } = get();
    if (!activeBackend) return;

    let payload = raw;
    if (ctrlSticky && raw.length === 1) {
      const code = raw.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) {
        payload = String.fromCharCode(code - 64);
      }
      set({ ctrlSticky: false });
    } else if (altSticky && raw.length === 1) {
      payload = `\x1b${raw}`;
      set({ altSticky: false });
    }

    activeBackend.write(payload);
  },

  writeLine: (text, kind = 'info') => {
    for (const sub of lineSubscribers) {
      try {
        sub(text, kind);
      } catch {
        // ignore subscriber errors
      }
    }
  },

  subscribeLines: (cb) => {
    lineSubscribers.add(cb);
    return () => {
      lineSubscribers.delete(cb);
    };
  },
}));
