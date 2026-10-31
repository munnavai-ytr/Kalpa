'use client';

import { create } from 'zustand';
import { getKalpaDB, type EngineKind } from '@/lib/vfs/db';
import { useProviderStore } from '@/lib/providers/store';
import { useTerminalStore } from '@/stores/terminal';
import {
  CloudDevServerController,
  type DevServerStartOptions,
  type DevServerStartResult,
  type DevServerState,
} from '@/lib/sandbox/devServer';
import { createE2bSandboxSession } from '@/lib/sandbox/e2b';
import type { SandboxSession } from '@/lib/sandbox/provider';
import { createDebouncedVfsSync, syncFullVfsToSandbox } from '@/lib/sandbox/sync';
import { usePreviewStore } from '@/stores/preview';

export type CloudConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'error';

export interface CloudBeaconError {
  message: string;
  source?: string;
  line?: number;
}

export type CloudTailwindUnappliedReason = 'directives-unprocessed' | 'utilities-missing';

interface SandboxStoreState {
  engine: EngineKind;
  projectId: string | null;
  status: CloudConnectionState;
  session: SandboxSession | null;
  sandboxId: string | null;
  expiresAt: number | null;
  remainingMs: number;
  errorMessage: string | null;
  userSelectedCloud: boolean;

  devServerStatus: DevServerState;
  devServerPort: number;
  devServerUrl: string | null;
  devServerLogTail: string;
  hostProbeOk: boolean;
  hostBlockedMessage: string | null;
  cloudBeaconErrors: CloudBeaconError[];
  cloudBlankScreen: boolean;
  cloudStylesUnapplied: CloudTailwindUnappliedReason | null;

  syncEngineFromProject: (projectId: string, engine: EngineKind) => void;
  switchEngine: (projectId: string, nextEngine: EngineKind) => Promise<boolean>;
  connectCloud: (projectId: string) => Promise<SandboxSession | null>;
  disconnectCloud: () => Promise<void>;
  extendCloud: (addMs?: number) => Promise<void>;
  recreateCloud: (projectId: string) => Promise<void>;
  runDevServer: (projectId: string, forceInstall?: boolean) => Promise<void>;
  startDevServerCommand: (
    projectId: string,
    opts?: Omit<DevServerStartOptions, 'onTerminalEcho'>
  ) => Promise<DevServerStartResult>;
  ensureDevServerRunning: (projectId: string) => Promise<DevServerStartResult | null>;
  getLastDevServerOverride: () => { command?: string; port?: number } | null;
  probeActiveHost: () => Promise<{ ok: boolean; blockedMessage: string | null }>;
  stopDevServer: () => Promise<void>;
  pushCloudBeaconError: (err: CloudBeaconError) => void;
  setCloudBlankScreen: (blank: boolean) => void;
  setCloudStylesUnapplied: (reason: CloudTailwindUnappliedReason | null) => void;
  clearCloudRuntimeSignals: () => void;
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
  userSelectedCloud: false,

  devServerStatus: 'stopped',
  devServerPort: 3000,
  devServerUrl: null,
  devServerLogTail: '',
  hostProbeOk: false,
  hostBlockedMessage: null,
  cloudBeaconErrors: [],
  cloudBlankScreen: false,
  cloudStylesUnapplied: null,

  syncEngineFromProject: (projectId, engine) => {
    const prevPid = get().projectId;
    if (prevPid && prevPid !== projectId && get().session) {
      void get().disconnectCloud();
    }
    set({ projectId, engine, userSelectedCloud: engine === 'cloud' });
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
      set({ engine: 'instant', projectId, errorMessage: null, userSelectedCloud: false });
      return true;
    }

    const e2bKey = useProviderStore.getState().e2bApiKey;
    if (!e2bKey.trim()) {
      set({
        engine: 'instant',
        userSelectedCloud: false,
        errorMessage: 'Add your E2B API key in Settings -> Engines to enable Cloud Sandbox.',
      });
      return false;
    }

    set({ engine: 'cloud', projectId, userSelectedCloud: true });
    const session = await get().connectCloud(projectId);
    return Boolean(session);
  },

  connectCloud: async (projectId) => {
    const e2bKey = useProviderStore.getState().e2bApiKey;
    if (!e2bKey.trim()) {
      set({ status: 'error', errorMessage: 'E2B API key is not configured.' });
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
      hostProbeOk: false,
      hostBlockedMessage: null,
      cloudBeaconErrors: [],
      cloudBlankScreen: false,
      cloudStylesUnapplied: null,
    });

    try {
      const session = await createE2bSandboxSession(e2bKey);
      if (!projectId.startsWith('_diag_')) {
        const { runProjectScaffoldDoctor } = await import('@/lib/agent/verify');
        await runProjectScaffoldDoctor(projectId, { source: 'cloud-devserver' });
      }
      const initialMap = await syncFullVfsToSandbox(projectId, session);

      devController = new CloudDevServerController(() => {
        if (!devController) return;
        set({
          devServerStatus: devController.status,
          devServerPort: devController.port,
          devServerUrl: devController.previewUrl,
          devServerLogTail: devController.getLogTail(40),
          hostProbeOk: devController.hostProbeOk,
          hostBlockedMessage: devController.hostBlockedMessage,
        });
      });

      stopVfsSync = createDebouncedVfsSync({
        projectId,
        initialMap,
        getSession: () => get().session,
        onPackageJsonChanged: () => {
          const curSession = get().session;
          if (curSession && devController) {
            set({ cloudBeaconErrors: [], cloudBlankScreen: false, cloudStylesUnapplied: null });
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
          if (devController) {
            void devController.stop().catch(() => {});
          }
          set({
            status: 'expired',
            session: null,
            remainingMs: 0,
            devServerStatus: 'stopped',
            devServerUrl: null,
            hostProbeOk: false,
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

      // A6(a): Automatically start dev server on connect if runnable web files exist
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
      hostProbeOk: false,
      hostBlockedMessage: null,
      cloudBeaconErrors: [],
      cloudBlankScreen: false,
      cloudStylesUnapplied: null,
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
    set({ cloudBeaconErrors: [], cloudBlankScreen: false, cloudStylesUnapplied: null });
    let docPkgChanged = false;
    if (!projectId.startsWith('_diag_')) {
      const { runProjectScaffoldDoctor } = await import('@/lib/agent/verify');
      const docOut = await runProjectScaffoldDoctor(projectId, {
        source: 'cloud-devserver',
        session,
      });
      docPkgChanged = docOut.pkgChanged;
    }
    const res = await devController.startOrRestart(projectId, session, {
      forceInstall: forceInstall || docPkgChanged,
      onTerminalEcho: (l) => useTerminalStore.getState().writeLine(l, 'system'),
    });
    if (res.status === 'running') {
      usePreviewStore.getState().reloadPreview();
    }
  },

  startDevServerCommand: async (projectId, opts) => {
    const session = get().session;
    if (!session || !devController) {
      return {
        status: 'crashed',
        port: opts?.port ?? 3000,
        url: null,
        logTail: 'Cloud Sandbox session is not connected.',
        hostBlockedMessage: null,
      };
    }
    set({ cloudBeaconErrors: [], cloudBlankScreen: false, cloudStylesUnapplied: null });
    let docPkgChanged = false;
    if (!projectId.startsWith('_diag_')) {
      const { runProjectScaffoldDoctor } = await import('@/lib/agent/verify');
      const docOut = await runProjectScaffoldDoctor(projectId, {
        source: 'cloud-devserver',
        session,
      });
      docPkgChanged = docOut.pkgChanged;
    }
    const res = await devController.startOrRestart(projectId, session, {
      ...opts,
      forceInstall: Boolean(opts?.forceInstall || docPkgChanged),
      onTerminalEcho: (l) => useTerminalStore.getState().writeLine(l, 'system'),
    });
    if (res.status === 'running') {
      usePreviewStore.getState().reloadPreview();
    }
    return res;
  },

  ensureDevServerRunning: async (projectId) => {
    const state = get();
    if (state.status !== 'connected' || !state.session || !devController) return null;
    if (
      state.devServerStatus === 'running' ||
      state.devServerStatus === 'installing' ||
      state.devServerStatus === 'starting'
    ) {
      return null;
    }
    set({ cloudBeaconErrors: [], cloudBlankScreen: false, cloudStylesUnapplied: null });
    let docPkgChanged = false;
    if (!projectId.startsWith('_diag_')) {
      const { runProjectScaffoldDoctor } = await import('@/lib/agent/verify');
      const docOut = await runProjectScaffoldDoctor(projectId, {
        source: 'cloud-devserver',
        session: state.session,
      });
      docPkgChanged = docOut.pkgChanged;
    }
    return devController.startOrRestart(projectId, state.session, {
      forceInstall: docPkgChanged,
      onTerminalEcho: (l) => useTerminalStore.getState().writeLine(l, 'system'),
    });
  },

  getLastDevServerOverride: () => devController?.getLastOverride() ?? null,

  probeActiveHost: async () => {
    const state = get();
    if (!state.session || !devController || state.devServerStatus !== 'running' || !state.devServerUrl) {
      return { ok: state.hostProbeOk, blockedMessage: state.hostBlockedMessage };
    }
    try {
      const host = new URL(state.devServerUrl).host;
      const res = await devController.probeHostOnce(state.session, state.devServerPort, host);
      const blocked =
        Boolean(res.blockedHost) || res.httpCode === 403 || res.httpCode === 421;
      if (blocked) {
        const msg =
          res.bodyHead.trim() ||
          `Blocked request. Host "${host}" rejected with HTTP ${res.httpCode}.`;
        set({ hostProbeOk: false, hostBlockedMessage: msg });
        return { ok: false, blockedMessage: msg };
      }
      const ok = res.httpCode >= 200 && res.httpCode < 500;
      set({ hostProbeOk: ok, hostBlockedMessage: null });
      return { ok, blockedMessage: null };
    } catch {
      return { ok: state.hostProbeOk, blockedMessage: state.hostBlockedMessage };
    }
  },

  stopDevServer: async () => {
    if (devController) {
      await devController.stop();
    }
  },

  pushCloudBeaconError: (err) =>
    set((s) => ({
      cloudBeaconErrors: [...s.cloudBeaconErrors.slice(-19), err],
    })),

  setCloudBlankScreen: (cloudBlankScreen) => set({ cloudBlankScreen }),

  setCloudStylesUnapplied: (cloudStylesUnapplied) => set({ cloudStylesUnapplied }),

  clearCloudRuntimeSignals: () =>
    set({ cloudBeaconErrors: [], cloudBlankScreen: false, cloudStylesUnapplied: null }),
}));
