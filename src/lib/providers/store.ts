'use client';

import { create } from 'zustand';
import {
  modelsRequest,
  parseModels,
  streamChat,
  type ProviderConfig,
  type ProviderKind,
} from './core';
import {
  loadVaultState,
  persistVaultSecrets,
  unlockEncryptedVault,
  type SecretBundle,
  type VaultMode,
} from './vault';
import { getSetting, setSetting } from '@/lib/vfs/db';
import { uid } from '@/lib/utils';

export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'gemini', label: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'together', label: 'Together', kind: 'openai', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'mistral', label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'xai', label: 'xAI', kind: 'openai', baseUrl: 'https://api.x.ai/v1' },
  { id: 'ollama', label: 'Ollama local', kind: 'openai', baseUrl: 'http://localhost:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio local', kind: 'openai', baseUrl: 'http://localhost:1234/v1' },
  { id: 'custom', label: 'Custom OpenAI-compatible', kind: 'openai', baseUrl: '' },
];

export interface ProviderProfile {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  contextTokens: number;
  temperature?: number;
  useProxy: boolean;
}

export interface FetchedModel {
  id: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  ttftMs?: number;
  totalMs: number;
  reply?: string;
  error?: string;
  suggestProxy?: boolean;
}

type StoredProfileMeta = Omit<ProviderProfile, 'apiKey'>;

const PROFILES_META_KEY = 'provider_profiles_meta';
const ACTIVE_PROFILE_KEY = 'active_profile_id';

let sessionPassphrase: string | undefined;

function isCorsOrNetworkFailure(err: unknown, baseUrl: string): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const isLocal = /localhost|127\.0\.0\.1/.test(baseUrl);
  if (isLocal) return false;
  return /failed to fetch|networkerror|load failed|cors/i.test(msg);
}

interface ProviderStoreState {
  initialized: boolean;
  profiles: ProviderProfile[];
  activeProfileId: string | null;
  vaultMode: VaultMode;
  vaultLocked: boolean;
  e2bApiKey: string;
  githubToken: string;

  initProviders: () => Promise<void>;
  getActiveProfile: () => ProviderProfile | null;
  unlockVault: (passphrase: string) => Promise<void>;
  changeVaultMode: (mode: VaultMode, passphrase?: string) => Promise<void>;
  upsertProfile: (profile: Omit<ProviderProfile, 'id'> & { id?: string }) => Promise<ProviderProfile>;
  deleteProfile: (id: string) => Promise<void>;
  removeProfileKey: (id: string) => Promise<void>;
  setActiveProfile: (id: string) => Promise<void>;
  setE2bApiKey: (key: string) => Promise<void>;
  setGithubToken: (token: string) => Promise<void>;
  fetchModels: (cfg: Pick<ProviderConfig, 'kind' | 'baseUrl' | 'apiKey' | 'useProxy'>) => Promise<FetchedModel[]>;
  testConnection: (cfg: ProviderConfig) => Promise<ConnectionTestResult>;
}

async function saveAllToStorage(
  profiles: ProviderProfile[],
  activeProfileId: string | null,
  vaultMode: VaultMode,
  e2bApiKey: string,
  githubToken: string
) {
  const metas: StoredProfileMeta[] = profiles.map(({ apiKey: _omit, ...rest }) => rest);
  await setSetting(PROFILES_META_KEY, metas);
  await setSetting(ACTIVE_PROFILE_KEY, activeProfileId);

  const secrets: SecretBundle = {
    keysByProfileId: Object.fromEntries(
      profiles.filter((p) => p.apiKey).map((p) => [p.id, p.apiKey])
    ),
    e2bApiKey: e2bApiKey || undefined,
    githubToken: githubToken || undefined,
  };
  await persistVaultSecrets(vaultMode, secrets, sessionPassphrase);
}

export const useProviderStore = create<ProviderStoreState>((set, get) => ({
  initialized: false,
  profiles: [],
  activeProfileId: null,
  vaultMode: 'device',
  vaultLocked: false,
  e2bApiKey: '',
  githubToken: '',

  initProviders: async () => {
    if (get().initialized) return;
    const [metas, activeId, vault] = await Promise.all([
      getSetting<StoredProfileMeta[]>(PROFILES_META_KEY),
      getSetting<string | null>(ACTIVE_PROFILE_KEY),
      loadVaultState(),
    ]);
    const list: ProviderProfile[] = (metas ?? []).map((m) => ({
      ...m,
      apiKey: vault.secrets.keysByProfileId[m.id] ?? '',
    }));
    const validActive =
      activeId && list.some((p) => p.id === activeId) ? activeId : (list[0]?.id ?? null);
    set({
      initialized: true,
      profiles: list,
      activeProfileId: validActive,
      vaultMode: vault.mode,
      vaultLocked: vault.locked,
      e2bApiKey: vault.secrets.e2bApiKey ?? '',
      githubToken: vault.secrets.githubToken ?? '',
    });
  },

  getActiveProfile: () => {
    const { profiles, activeProfileId } = get();
    if (!activeProfileId) return profiles[0] ?? null;
    return profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;
  },

  unlockVault: async (passphrase) => {
    const secrets = await unlockEncryptedVault(passphrase);
    sessionPassphrase = passphrase;
    set((s) => ({
      vaultLocked: false,
      e2bApiKey: secrets.e2bApiKey ?? '',
      githubToken: secrets.githubToken ?? '',
      profiles: s.profiles.map((p) => ({
        ...p,
        apiKey: secrets.keysByProfileId[p.id] ?? '',
      })),
    }));
  },

  changeVaultMode: async (mode, passphrase) => {
    if (mode === 'encrypted') {
      if (!passphrase || passphrase.length < 4) {
        throw new Error('Passphrase must be at least 4 characters');
      }
      sessionPassphrase = passphrase;
    } else {
      sessionPassphrase = undefined;
    }
    const { profiles, activeProfileId, e2bApiKey, githubToken } = get();
    await saveAllToStorage(profiles, activeProfileId, mode, e2bApiKey, githubToken);
    set({ vaultMode: mode, vaultLocked: false });
  },

  upsertProfile: async (input) => {
    const id = input.id || uid('prov');
    const full: ProviderProfile = {
      id,
      label: input.label.trim() || 'Provider',
      kind: input.kind,
      baseUrl: input.baseUrl.trim(),
      apiKey: input.apiKey.trim(),
      model: input.model.trim(),
      maxOutputTokens: input.maxOutputTokens || 8192,
      contextTokens: input.contextTokens || 128000,
      temperature: input.temperature,
      useProxy: Boolean(input.useProxy),
    };
    const prev = get().profiles;
    const exists = prev.some((p) => p.id === id);
    const profiles = exists ? prev.map((p) => (p.id === id ? full : p)) : [...prev, full];
    const activeProfileId = get().activeProfileId ?? id;
    set({ profiles, activeProfileId });
    if (!get().vaultLocked) {
      await saveAllToStorage(profiles, activeProfileId, get().vaultMode, get().e2bApiKey, get().githubToken);
    }
    return full;
  },

  deleteProfile: async (id) => {
    const profiles = get().profiles.filter((p) => p.id !== id);
    const activeProfileId =
      get().activeProfileId === id ? (profiles[0]?.id ?? null) : get().activeProfileId;
    set({ profiles, activeProfileId });
    if (!get().vaultLocked) {
      await saveAllToStorage(profiles, activeProfileId, get().vaultMode, get().e2bApiKey, get().githubToken);
    }
  },

  removeProfileKey: async (id) => {
    const profiles = get().profiles.map((p) => (p.id === id ? { ...p, apiKey: '' } : p));
    set({ profiles });
    if (!get().vaultLocked) {
      await saveAllToStorage(profiles, get().activeProfileId, get().vaultMode, get().e2bApiKey, get().githubToken);
    }
  },

  setActiveProfile: async (id) => {
    set({ activeProfileId: id });
    await setSetting(ACTIVE_PROFILE_KEY, id);
  },

  setE2bApiKey: async (e2bApiKey) => {
    set({ e2bApiKey });
    if (!get().vaultLocked) {
      await saveAllToStorage(get().profiles, get().activeProfileId, get().vaultMode, e2bApiKey, get().githubToken);
    }
  },

  setGithubToken: async (githubToken) => {
    set({ githubToken });
    if (!get().vaultLocked) {
      await saveAllToStorage(get().profiles, get().activeProfileId, get().vaultMode, get().e2bApiKey, githubToken);
    }
  },

  fetchModels: async (cfg) => {
    const req = modelsRequest(cfg);
    const res = cfg.useProxy
      ? await fetch('/api/proxy', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: req.url, method: 'GET', headers: req.init.headers }),
        })
      : await fetch(req.url, req.init);

    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        // ignore
      }
      throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
    }
    const json = await res.json();
    return parseModels(cfg.kind, json);
  },

  testConnection: async (cfg) => {
    const start = performance.now();
    let ttftMs: number | undefined;
    let reply = '';
    try {
      const testCfg: ProviderConfig = {
        ...cfg,
        maxOutputTokens: Math.min(cfg.maxOutputTokens || 64, 64),
      };
      for await (const ev of streamChat(testCfg, [{ role: 'user', content: 'Say OK' }])) {
        if (ev.delta) {
          if (ttftMs === undefined) {
            ttftMs = Math.round(performance.now() - start);
          }
          reply += ev.delta;
        }
      }
      return {
        ok: true,
        ttftMs: ttftMs ?? Math.round(performance.now() - start),
        totalMs: Math.round(performance.now() - start),
        reply: reply.trim() || '(empty stream completed)',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        totalMs: Math.round(performance.now() - start),
        error: msg,
        suggestProxy: !cfg.useProxy && isCorsOrNetworkFailure(err, cfg.baseUrl),
      };
    }
  },
}));
