'use client';

import { create } from 'zustand';
import { getKalpaDB, type EngineKind } from '@/lib/vfs/db';
import { useProviderStore } from '@/lib/providers/store';
import { useTerminalStore } from '@/stores/terminal';
import { CloudDevServerController, type DevServerState } from '@/lib/sandbox/devServer';
import { createE2bSandboxSession } from '@/lib/sandbox/e2b';
import type { SandboxSession } from '@/lib/sandbox/provider';
import { createDebouncedVfsSync, syncFullVfsToSandbox } from '@/lib/sandbox/sync';

export type CloudConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'error';

interface SandboxStoreState {
  engine: EngineKind;
  projectId: string | null;
  status: CloudConnectionState;
  session: SandboxSession | null;
  sandboxId: string | null;
  expiresAt: number | null;
  remainingMs: number;
  errorMessage: string | null;

  devServerStatus: DevServerState;
  devServerPort: number;
  devServerUrl: string | null;
  devServerLogTail: string;

  syncEngineFromProject: (projectId: string, engine: EngineKind) => void;
  switchEngine: (projectId: string, nextEngine: EngineKind) => Promise<boolean>;
  connectCloud: (projectId: string) => Promise<SandboxSession | null>;
  disconnectCloud: () => Promise<void>;
  extendCloud: (addMs?: number) => Promise<void>;
  recreateCloud: (projectId: string) => Promise<void>;
  runDevServer: (projectId: string, forceInstall?: boolean) => Promise<void>;
  stopDevServer: () => Promise<void>;
}

let countdownInterval: ReturnType<typeof setInterval> | null = null;
let stopVfsSync: (() => void) | null = null;
let devController: CloudDevServerController | null = null;

function clearTimersAndWatchers() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (stopVfsSync) {
    stopVfsSync();
    stopVfsSync = null;
  }
}

export const useSandboxStore = create<SandboxStoreState>((set, get) => ({
  engine: 'instant',
  projectId: null,
  status: 'disconnected',
  session: null,
  sandboxId: null,
  expiresAt: null,
  remainingMs: 0,
  errorMessage: null,

  devServerStatus: 'stopped',
  devServerPort: 3000,
  devServerUrl: null,
  devServerLogTail: '',

  syncEngineFromProject: (projectId, engine) => {
    const prevPid = get().projectId;
    if (prevPid && prevPid !== projectId && get().session) {
      void get().disconnectCloud();
    }
    set({ projectId, engine });
    if (engine === 'cloud' && get().status === 'disconnected') {
      const key = useProviderStore.getState().e2bApiKey;
      if (key) {
        void get().connectCloud(projectId);
      }
    }
  },

  switchEngine: async (projectId, nextEngine) => {
    const db = await getKalpaDB();
    const proj = await db.get('projects', projectId);
    if (proj) {
      proj.engine = nextEngine;
      proj.updatedAt = Date.now();
      await db.put('projects', proj);
    }

    if (nextEngine === 'instant') {
      await get().disconnectCloud();
      set({ engine: 'instant', projectId, errorMessage: null });
      return true;
    }

    const e2bKey = useProviderStore.getState().e2bApiKey;
    if (!e2bKey.trim()) {
      set({
        engine: 'instant',
        errorMessage: 'Add your E2B API key in Settings -> Engines to enable Cloud Sandbox.',
      });
      return false;
    }

    set({ engine: 'cloud', projectId });
    const session = await get().connectCloud(projectId);
    return Boolean(session);
  },

  connectCloud: async (projectId) => {
    const e2bKey = useProviderStore.getState().e2bApiKey;
    if (!e2bKey.trim()) {
      set({
        status: 'error',
        errorMessage: 'E2B API key is not configured.',
      });
      return null;
    }

    if (get().status === 'connecting') return null;

    clearTimersAndWatchers();
    if (devController) {
      await devController.stop().catch(() => {});
      devController = null;
    }
    if (get().session) {
      await get().session!.kill().catch(() => {});
    }

    set({
      projectId,
      status: 'connecting',
      errorMessage: null,
      devServerStatus: 'stopped',
      devServerUrl: null,
      devServerLogTail: '',
    });

    try {
      const session = await createE2bSandboxSession(e2bKey);
      const initialMap = await syncFullVfsToSandbox(projectId, session);

      devController = new CloudDevServerController(() => {
        if (!devController) return;
        set({
          devServerStatus: devController.status,
          devServerPort: devController.port,
          devServerUrl: devController.previewUrl,
          devServerLogTail: devController.getLogTail(40),
        });
      });

      stopVfsSync = createDebouncedVfsSync({
        projectId,
        initialMap,
        getSession: () => get().session,
        onPackageJsonChanged: () => {
          const curSession = get().session;
          if (curSession && devController) {
            void devController.startOrRestart(projectId, curSession, {
              forceInstall: true,
              onTerminalEcho: (l) => useTerminalStore.getState().writeLine(l, 'system'),
            });
          }
        },
      });

      countdownInterval = setInterval(() => {
        const exp = get().expiresAt;
        if (!exp) return;
        const rem = Math.max(0, exp - Date.now());
        if (rem <= 0) {
          clearTimersAndWatchers();
          set({
            status: 'expired',
            session: null,
            remainingMs: 0,
            devServerStatus: 'stopped',
            devServerUrl: null,
          });
        } else {
          set({ remainingMs: rem });
        }
      }, 1000);

      set({
        engine: 'cloud',
        status: 'connected',
        session,
        sandboxId: session.id,
        expiresAt: session.expiresAt,
        remainingMs: Math.max(0, session.expiresAt - Date.now()),
      });

      // Automatically start dev server if project has runnable web files
      void devController.startOrRestart(projectId, session, {
        onTerminalEcho: (l) => useTerminalStore.getState().writeLine(l, 'system'),
      });

      return session;
    } catch (err) {
      clearTimersAndWatchers();
      const msg = err instanceof Error ? err.message : String(err);
      set({
        status: 'error',
        session: null,
        sandboxId: null,
        errorMessage: msg,
      });
      return null;
    }
  },

  disconnectCloud: async () => {
    clearTimersAndWatchers();
    if (devController) {
      await devController.stop().catch(() => {});
      devController = null;
    }
    const existing = get().session;
    if (existing) {
      await existing.kill().catch(() => {});
    }
    set({
      status: 'disconnected',
      session: null,
      sandboxId: null,
      expiresAt: null,
      remainingMs: 0,
      devServerStatus: 'stopped',
      devServerUrl: null,
      devServerLogTail: '',
    });
  },

  extendCloud: async (addMs = 15 * 60 * 1000) => {
    const session = get().session;
    if (!session) return;
    const nextExp = await session.extend(addMs);
    set({
      expiresAt: nextExp,
      remainingMs: Math.max(0, nextExp - Date.now()),
    });
  },

  recreateCloud: async (projectId) => {
    await get().connectCloud(projectId);
  },

  runDevServer: async (projectId, forceInstall = false) => {
    const session = get().session;
    if (!session || !devController) return;
    await devController.startOrRestart(projectId, session, {
      forceInstall,
      onTerminalEcho: (l) => useTerminalStore.getState().writeLine(l, 'system'),
    });
  },

  stopDevServer: async () => {
    if (devController) {
      await devController.stop();
    }
  },
}));
