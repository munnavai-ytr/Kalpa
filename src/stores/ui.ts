'use client';

import { create } from 'zustand';
import { uid } from '@/lib/utils';

export type ThemeChoice = 'dark' | 'light' | 'system';
export type IdeTab = 'chat' | 'code' | 'preview' | 'terminal';
export type TabletRightMode = 'preview' | 'code';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  kind?: 'info' | 'success' | 'warn' | 'error';
}

interface UiState {
  theme: ThemeChoice;
  editorFontSize: number;
  editorWordWrap: boolean;
  reduceMotion: boolean;
  activeIdeTab: IdeTab;
  tabletRightMode: TabletRightMode;
  filesTreeCollapsed: boolean;
  filesDrawerOpen: boolean;
  terminalCollapsed: boolean;
  tabletTerminalOpen: boolean;
  modelSheetOpen: boolean;
  keySetupOpen: boolean;
  toasts: ToastItem[];

  hydrateAppearance: () => void;
  setTheme: (theme: ThemeChoice) => void;
  setEditorFontSize: (size: number) => void;
  setEditorWordWrap: (wrap: boolean) => void;
  setReduceMotion: (reduce: boolean) => void;
  setActiveIdeTab: (tab: IdeTab) => void;
  setTabletRightMode: (mode: TabletRightMode) => void;
  setFilesTreeCollapsed: (collapsed: boolean) => void;
  setFilesDrawerOpen: (open: boolean) => void;
  setTerminalCollapsed: (collapsed: boolean) => void;
  setTabletTerminalOpen: (open: boolean) => void;
  setModelSheetOpen: (open: boolean) => void;
  setKeySetupOpen: (open: boolean) => void;
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  dismissToast: (id: string) => void;
}

const APPEARANCE_KEY = 'kalpa_appearance_v1';

function applyDomTheme(theme: ThemeChoice, reduceMotion: boolean) {
  if (typeof document === 'undefined') return;
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme;
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-reduce-motion', reduceMotion ? 'true' : 'false');
}

function persistAppearance(data: {
  theme: ThemeChoice;
  editorFontSize: number;
  editorWordWrap: boolean;
  reduceMotion: boolean;
}) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: 'dark',
  editorFontSize: 14,
  editorWordWrap: true,
  reduceMotion: false,
  activeIdeTab: 'chat',
  tabletRightMode: 'preview',
  filesTreeCollapsed: false,
  filesDrawerOpen: false,
  terminalCollapsed: false,
  tabletTerminalOpen: false,
  modelSheetOpen: false,
  keySetupOpen: false,
  toasts: [],

  hydrateAppearance: () => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(APPEARANCE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<UiState>;
        const theme = parsed.theme ?? 'dark';
        const editorFontSize = typeof parsed.editorFontSize === 'number' ? parsed.editorFontSize : 14;
        const editorWordWrap = parsed.editorWordWrap ?? true;
        const reduceMotion = parsed.reduceMotion ?? false;
        set({ theme, editorFontSize, editorWordWrap, reduceMotion });
        applyDomTheme(theme, reduceMotion);
        return;
      }
    } catch {
      // ignore invalid JSON
    }
    applyDomTheme(get().theme, get().reduceMotion);
  },

  setTheme: (theme) => {
    set({ theme });
    const s = get();
    applyDomTheme(theme, s.reduceMotion);
    persistAppearance({
      theme,
      editorFontSize: s.editorFontSize,
      editorWordWrap: s.editorWordWrap,
      reduceMotion: s.reduceMotion,
    });
  },

  setEditorFontSize: (size) => {
    const clamped = Math.max(12, Math.min(24, size));
    set({ editorFontSize: clamped });
    const s = get();
    persistAppearance({
      theme: s.theme,
      editorFontSize: clamped,
      editorWordWrap: s.editorWordWrap,
      reduceMotion: s.reduceMotion,
    });
  },

  setEditorWordWrap: (editorWordWrap) => {
    set({ editorWordWrap });
    const s = get();
    persistAppearance({
      theme: s.theme,
      editorFontSize: s.editorFontSize,
      editorWordWrap,
      reduceMotion: s.reduceMotion,
    });
  },

  setReduceMotion: (reduceMotion) => {
    set({ reduceMotion });
    const s = get();
    applyDomTheme(s.theme, reduceMotion);
    persistAppearance({
      theme: s.theme,
      editorFontSize: s.editorFontSize,
      editorWordWrap: s.editorWordWrap,
      reduceMotion,
    });
  },

  setActiveIdeTab: (activeIdeTab) => set({ activeIdeTab }),
  setTabletRightMode: (tabletRightMode) => set({ tabletRightMode }),
  setFilesTreeCollapsed: (filesTreeCollapsed) => set({ filesTreeCollapsed }),
  setFilesDrawerOpen: (filesDrawerOpen) => set({ filesDrawerOpen }),
  setTerminalCollapsed: (terminalCollapsed) => set({ terminalCollapsed }),
  setTabletTerminalOpen: (tabletTerminalOpen) => set({ tabletTerminalOpen }),
  setModelSheetOpen: (modelSheetOpen) => set({ modelSheetOpen }),
  setKeySetupOpen: (keySetupOpen) => set({ keySetupOpen }),

  addToast: (toast) => {
    const id = uid('toast');
    set((state) => ({ toasts: [...state.toasts.slice(-4), { ...toast, id }] }));
    setTimeout(() => {
      get().dismissToast(id);
    }, 4200);
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
