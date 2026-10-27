'use client';

import React, { useState } from 'react';
import { Check, Eye, EyeOff, RefreshCw, Zap } from 'lucide-react';
import {
  PROVIDER_PRESETS,
  useProviderStore,
  type ConnectionTestResult,
  type FetchedModel,
  type ProviderProfile,
} from '@/lib/providers/store';
import type { ProviderKind } from '@/lib/providers/core';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useUiStore } from '@/stores/ui';
import { VaultAndProfilesSection } from './VaultAndProfilesSection';

export function ProvidersTab() {
  const profiles = useProviderStore((s) => s.profiles);
  const upsertProfile = useProviderStore((s) => s.upsertProfile);
  const fetchModels = useProviderStore((s) => s.fetchModels);
  const testConnection = useProviderStore((s) => s.testConnection);
  const addToast = useUiStore((s) => s.addToast);

  const [editingId, setEditingId] = useState<string | null>(profiles[0]?.id ?? 'new');
  const [label, setLabel] = useState('OpenAI');
  const [kind, setKind] = useState<ProviderKind>('openai');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState(8192);
  const [contextTokens, setContextTokens] = useState(128000);
  const [tempStr, setTempStr] = useState('');
  const [useProxy, setUseProxy] = useState(false);

  const [models, setModels] = useState<FetchedModel[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [comboOpen, setComboOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const loadForEdit = (p: ProviderProfile) => {
    setEditingId(p.id);
    setLabel(p.label);
    setKind(p.kind);
    setBaseUrl(p.baseUrl);
    setApiKey(p.apiKey);
    setModel(p.model);
    setMaxOutputTokens(p.maxOutputTokens);
    setContextTokens(p.contextTokens);
    setTempStr(p.temperature !== undefined ? String(p.temperature) : '');
    setUseProxy(p.useProxy);
    setModels([]);
    setTestResult(null);
  };

  const applyPreset = (presetId: string) => {
    const preset = PROVIDER_PRESETS.find((x) => x.id === presetId);
    if (!preset) return;
    setEditingId('new');
    setLabel(preset.label);
    setKind(preset.kind);
    setBaseUrl(preset.baseUrl);
    setApiKey('');
    setModel('');
    setMaxOutputTokens(8192);
    setContextTokens(128000);
    setTempStr('');
    setUseProxy(false);
    setModels([]);
    setTestResult(null);
  };

  const handleFetchModels = async () => {
    if (!baseUrl.trim()) {
      addToast({ title: 'Enter a Base URL first', kind: 'warn' });
      return;
    }
    setFetchingModels(true);
    try {
      const list = await fetchModels({ kind, baseUrl, apiKey, useProxy });
      setModels(list);
      setComboOpen(true);
      addToast({ title: `Fetched ${list.length} models`, kind: 'success' });
    } catch (err) {
      addToast({
        title: 'Could not fetch models',
        description: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const selectFetchedModel = (m: FetchedModel) => {
    setModel(m.id);
    if (m.inputTokens) setContextTokens(m.inputTokens);
    if (m.outputTokens) setMaxOutputTokens(m.outputTokens);
    setComboOpen(false);
  };

  const runTest = async (overrideProxy?: boolean) => {
    if (!model.trim()) {
      addToast({ title: 'Enter or select a model ID before testing', kind: 'warn' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    const proxyFlag = overrideProxy ?? useProxy;
    if (overrideProxy !== undefined) setUseProxy(overrideProxy);
    const parsedTemp = tempStr.trim() === '' ? undefined : Number(tempStr);
    const res = await testConnection({
      kind,
      baseUrl,
      apiKey,
      model: model.trim(),
      maxOutputTokens,
      temperature: Number.isFinite(parsedTemp) ? parsedTemp : undefined,
      useProxy: proxyFlag,
    });
    setTestResult(res);
    setTesting(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!model.trim()) {
      addToast({ title: 'Model ID is required', kind: 'warn' });
      return;
    }
    const parsedTemp = tempStr.trim() === '' ? undefined : Number(tempStr);
    const saved = await upsertProfile({
      id: editingId && editingId !== 'new' ? editingId : undefined,
      label,
      kind,
      baseUrl,
      apiKey,
      model: model.trim(),
      maxOutputTokens,
      contextTokens,
      temperature: Number.isFinite(parsedTemp) ? parsedTemp : undefined,
      useProxy,
    });
    setEditingId(saved.id);
    addToast({ title: `Saved ${saved.label}`, kind: 'success' });
  };

  const filteredModels = models.filter((m) =>
    m.id.toLowerCase().includes(model.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <VaultAndProfilesSection
        onNewProfile={() => applyPreset('openai')}
        onEditProfile={loadForEdit}
      />

      <Card>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-kalpa-text">
              {editingId === 'new' ? 'Add Provider Profile' : 'Edit Provider Profile'}
            </h3>
            <select
              aria-label="Load provider preset"
              onChange={(e) => applyPreset(e.target.value)}
              defaultValue=""
              className="min-h-[38px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-xs text-kalpa-text"
            >
              <option value="" disabled>
                Load preset…
              </option>
              {PROVIDER_PRESETS.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-kalpa-muted mb-1">Label</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                className="w-full min-h-[44px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm text-kalpa-text"
              />
            </div>
            <div>
              <label className="block text-xs text-kalpa-muted mb-1">Protocol</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as ProviderKind)}
                className="w-full min-h-[44px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm text-kalpa-text"
              >
                <option value="openai">OpenAI-compatible</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-kalpa-muted mb-1">Base URL</label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                required
                className="w-full min-h-[44px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono text-kalpa-text"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-kalpa-muted mb-1">API Key</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste API key (stays in your browser)…"
                  autoComplete="off"
                  className="w-full min-h-[44px] pl-3.5 pr-11 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono text-kalpa-text"
                />
                <button
                  type="button"
                  aria-label={showKey ? 'Hide API key' : 'Reveal API key'}
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-kalpa-muted hover:text-kalpa-text cursor-pointer"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button
                type="button"
                variant="secondary"
                loading={fetchingModels}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                onClick={handleFetchModels}
              >
                Fetch models
              </Button>
            </div>
          </div>

          <div className="relative">
            <label className="block text-xs text-kalpa-muted mb-1">
              Model ID (type freely or pick from fetched list)
            </label>
            <input
              value={model}
              onFocus={() => models.length > 0 && setComboOpen(true)}
              onBlur={() => setTimeout(() => setComboOpen(false), 160)}
              onChange={(e) => {
                setModel(e.target.value);
                if (models.length > 0) setComboOpen(true);
              }}
              placeholder="Click Fetch models or type exact model ID…"
              required
              className="w-full min-h-[44px] px-3.5 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono text-kalpa-text"
            />
            {comboOpen && filteredModels.length > 0 ? (
              <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-[12px] bg-kalpa-bg-2 border border-kalpa-border shadow-kalpa-soft p-1">
                {filteredModels.slice(0, 120).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onMouseDown={() => selectFetchedModel(m)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left text-xs font-mono text-kalpa-text hover:bg-kalpa-surface rounded-[8px] cursor-pointer"
                  >
                    <span className="truncate">{m.id}</span>
                    {m.inputTokens ? (
                      <span className="text-[11px] text-kalpa-muted tabular-nums ml-2 shrink-0">
                        {Math.round(m.inputTokens / 1000)}k ctx
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-kalpa-muted mb-1">Max Output</label>
              <input
                type="number"
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(Number(e.target.value) || 8192)}
                className="w-full min-h-[44px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono tabular-nums text-kalpa-text"
              />
            </div>
            <div>
              <label className="block text-xs text-kalpa-muted mb-1">Context Window</label>
              <input
                type="number"
                value={contextTokens}
                onChange={(e) => setContextTokens(Number(e.target.value) || 128000)}
                className="w-full min-h-[44px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono tabular-nums text-kalpa-text"
              />
            </div>
            <div>
              <label className="block text-xs text-kalpa-muted mb-1">Temp (opt)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={tempStr}
                onChange={(e) => setTempStr(e.target.value)}
                placeholder="Auto"
                className="w-full min-h-[44px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono tabular-nums text-kalpa-text"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-xs text-kalpa-text cursor-pointer select-none min-h-[36px]">
            <input
              type="checkbox"
              checked={useProxy}
              onChange={(e) => setUseProxy(e.target.checked)}
              className="w-4 h-4 accent-kalpa-violet"
            />
            Use stateless edge proxy (<code className="font-mono">/api/proxy</code>) for CORS-restricted hosts
          </label>

          {testResult ? (
            <div
              className={`p-3.5 rounded-[12px] border text-xs space-y-1.5 ${
                testResult.ok
                  ? 'border-kalpa-success/40 bg-kalpa-success/10 text-kalpa-text'
                  : 'border-kalpa-danger/40 bg-kalpa-danger/10 text-kalpa-text'
              }`}
            >
              {testResult.ok ? (
                <p className="font-mono tabular-nums">
                  PASS · First token: {testResult.ttftMs} ms · Total: {testResult.totalMs} ms · Reply: &ldquo;{testResult.reply}&rdquo;
                </p>
              ) : (
                <>
                  <p className="text-kalpa-danger font-medium">
                    Connection failed ({testResult.totalMs} ms): {testResult.error}
                  </p>
                  {testResult.suggestProxy ? (
                    <Button size="sm" variant="secondary" onClick={() => runTest(true)}>
                      Enable Use proxy &amp; retry
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              loading={testing}
              leftIcon={<Zap className="w-4 h-4" />}
              onClick={() => runTest()}
            >
              Test connection
            </Button>
            <Button type="submit" variant="primary" leftIcon={<Check className="w-4 h-4" />}>
              Save Profile
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
