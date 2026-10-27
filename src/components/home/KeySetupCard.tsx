'use client';

import React, { useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, RefreshCw, Zap } from 'lucide-react';
import {
  PROVIDER_PRESETS,
  useProviderStore,
  type ConnectionTestResult,
  type FetchedModel,
} from '@/lib/providers/store';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useUiStore } from '@/stores/ui';

export interface KeySetupCardProps {
  onSaved?: () => void;
  compact?: boolean;
}

export function KeySetupCard({ onSaved, compact = false }: KeySetupCardProps) {
  const upsertProfile = useProviderStore((s) => s.upsertProfile);
  const fetchModels = useProviderStore((s) => s.fetchModels);
  const testConnection = useProviderStore((s) => s.testConnection);
  const addToast = useUiStore((s) => s.addToast);

  const [presetId, setPresetId] = useState('gemini');
  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId) ?? PROVIDER_PRESETS[0];
  const [customBaseUrl, setCustomBaseUrl] = useState(preset.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [model, setModel] = useState('');
  const [contextTokens, setContextTokens] = useState(128000);
  const [maxOutputTokens, setMaxOutputTokens] = useState(8192);
  const [useProxy, setUseProxy] = useState(false);

  const [models, setModels] = useState<FetchedModel[]>([]);
  const [comboOpen, setComboOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<ConnectionTestResult | null>(null);

  const isLocalHost = /localhost|127\.0\.0\.1/.test(customBaseUrl);

  const handlePresetChange = (id: string) => {
    setPresetId(id);
    const next = PROVIDER_PRESETS.find((p) => p.id === id);
    if (next) {
      setCustomBaseUrl(next.baseUrl);
      setModels([]);
      setModel('');
      setTestRes(null);
    }
  };

  const handleFetchModels = async () => {
    if (!customBaseUrl.trim()) {
      addToast({ title: 'Enter a Base URL first', kind: 'warn' });
      return;
    }
    setFetching(true);
    try {
      const list = await fetchModels({
        kind: preset.kind,
        baseUrl: customBaseUrl,
        apiKey,
        useProxy,
      });
      setModels(list);
      setComboOpen(true);
      if (list.length === 1 && !model) {
        setModel(list[0].id);
      }
      addToast({ title: `Loaded ${list.length} models`, kind: 'success' });
    } catch (err) {
      addToast({
        title: 'Could not fetch models',
        description: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    } finally {
      setFetching(false);
    }
  };

  const handleTest = async (forceProxy?: boolean) => {
    if (!model.trim()) {
      addToast({ title: 'Fetch or enter a model ID first', kind: 'warn' });
      return;
    }
    const proxyFlag = forceProxy ?? useProxy;
    if (forceProxy !== undefined) setUseProxy(forceProxy);
    setTesting(true);
    setTestRes(null);
    const res = await testConnection({
      kind: preset.kind,
      baseUrl: customBaseUrl,
      apiKey,
      model: model.trim(),
      maxOutputTokens: 64,
      useProxy: proxyFlag,
    });
    setTestRes(res);
    setTesting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLocalHost && !apiKey.trim()) {
      addToast({ title: 'Please enter your API key', kind: 'warn' });
      return;
    }
    if (!model.trim()) {
      addToast({ title: 'Please fetch or enter a model ID', kind: 'warn' });
      return;
    }
    await upsertProfile({
      label: preset.label,
      kind: preset.kind,
      baseUrl: customBaseUrl,
      apiKey: apiKey.trim(),
      model: model.trim(),
      maxOutputTokens,
      contextTokens,
      useProxy,
    });
    addToast({ title: `${preset.label} connected`, kind: 'success' });
    onSaved?.();
  };

  const filtered = models.filter((m) => m.id.toLowerCase().includes(model.toLowerCase()));

  const content = (
    <form onSubmit={handleSubmit} className="space-y-3.5">
      {!compact ? (
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-[10px] bg-kalpa-violet/15 border border-kalpa-violet/30 flex items-center justify-center shrink-0">
            <KeyRound className="w-4 h-4 text-kalpa-violet" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-kalpa-text">Connect your AI key (BYOK)</h2>
            <p className="text-xs text-kalpa-muted mt-0.5">
              Keys stay locally in your browser. Choose a provider, fetch models, and save.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-kalpa-muted mb-1">Provider</label>
          <select
            value={presetId}
            onChange={(e) => handlePresetChange(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm text-kalpa-text"
          >
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-kalpa-muted mb-1">API Key</label>
          <div className="relative">
            <input
              type={reveal ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isLocalHost ? 'Optional for local server' : 'Paste API key…'}
              autoComplete="off"
              className="w-full min-h-[44px] pl-3.5 pr-10 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono text-kalpa-text"
            />
            <button
              type="button"
              aria-label={reveal ? 'Hide key' : 'Show key'}
              onClick={() => setReveal((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-kalpa-muted hover:text-kalpa-text cursor-pointer"
            >
              {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {presetId === 'custom' || isLocalHost ? (
        <div>
          <label className="block text-xs text-kalpa-muted mb-1">Base URL</label>
          <input
            value={customBaseUrl}
            onChange={(e) => setCustomBaseUrl(e.target.value)}
            placeholder="https://your-endpoint.example/v1"
            required
            className="w-full min-h-[44px] px-3.5 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono text-kalpa-text"
          />
        </div>
      ) : null}

      <div className="relative">
        <label className="block text-xs text-kalpa-muted mb-1">Model</label>
        <div className="flex gap-2">
          <input
            value={model}
            onFocus={() => models.length > 0 && setComboOpen(true)}
            onBlur={() => setTimeout(() => setComboOpen(false), 160)}
            onChange={(e) => {
              setModel(e.target.value);
              if (models.length > 0) setComboOpen(true);
            }}
            placeholder="Click Fetch models or type model ID…"
            required
            className="flex-1 min-h-[44px] px-3.5 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono text-kalpa-text"
          />
          <Button
            type="button"
            variant="secondary"
            loading={fetching}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={handleFetchModels}
          >
            Fetch
          </Button>
        </div>
        {comboOpen && filtered.length > 0 ? (
          <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded-[12px] bg-kalpa-bg-2 border border-kalpa-border shadow-kalpa-soft p-1">
            {filtered.slice(0, 100).map((m) => (
              <button
                key={m.id}
                type="button"
                onMouseDown={() => {
                  setModel(m.id);
                  if (m.inputTokens) setContextTokens(m.inputTokens);
                  if (m.outputTokens) setMaxOutputTokens(m.outputTokens);
                  setComboOpen(false);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-left text-xs font-mono text-kalpa-text hover:bg-kalpa-surface rounded-[8px] cursor-pointer"
              >
                <span className="truncate">{m.id}</span>
                {m.inputTokens ? (
                  <span className="text-[11px] text-kalpa-muted tabular-nums ml-2">
                    {Math.round(m.inputTokens / 1000)}k
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {testRes ? (
        <div
          className={`p-3 rounded-[10px] border text-xs ${
            testRes.ok
              ? 'border-kalpa-success/40 bg-kalpa-success/10 text-kalpa-text'
              : 'border-kalpa-danger/40 bg-kalpa-danger/10 text-kalpa-danger'
          }`}
        >
          {testRes.ok ? (
            <span className="font-mono tabular-nums">
              Connected · TTFT {testRes.ttftMs} ms · Reply: &ldquo;{testRes.reply}&rdquo;
            </span>
          ) : (
            <div className="space-y-1.5">
              <p>{testRes.error}</p>
              {testRes.suggestProxy ? (
                <Button size="sm" variant="secondary" onClick={() => handleTest(true)}>
                  Enable Use proxy &amp; retry
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <label className="inline-flex items-center gap-2 text-xs text-kalpa-muted cursor-pointer">
          <input
            type="checkbox"
            checked={useProxy}
            onChange={(e) => setUseProxy(e.target.checked)}
            className="w-4 h-4 accent-kalpa-violet"
          />
          Use CORS proxy
        </label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={testing}
            leftIcon={<Zap className="w-3.5 h-3.5" />}
            onClick={() => handleTest()}
          >
            Test
          </Button>
          <Button type="submit" size="sm" variant="primary" leftIcon={<Check className="w-3.5 h-3.5" />}>
            Save Key
          </Button>
        </div>
      </div>
    </form>
  );

  if (compact) return content;
  return <Card glass>{content}</Card>;
}
