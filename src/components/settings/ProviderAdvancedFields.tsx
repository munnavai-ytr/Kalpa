'use client';

import React from 'react';
import { Check, Zap } from 'lucide-react';
import type { ConnectionTestResult, ProviderProfile } from '@/lib/providers/store';
import { Button } from '@/components/ui/Button';

export interface ProviderAdvancedFieldsProps {
  editedSaved?: ProviderProfile;
  maxOutputTokens: number;
  onChangeMaxOutput: (val: number) => void;
  contextTokens: number;
  onChangeContextTokens: (val: number) => void;
  tempStr: string;
  onChangeTempStr: (val: string) => void;
  useProxy: boolean;
  onChangeUseProxy: (val: boolean) => void;
  economyMode: boolean;
  onChangeEconomyMode: (val: boolean) => void;
  strictFormat: boolean;
  onChangeStrictFormat: (val: boolean) => void;
  extraBodyStr: string;
  onChangeExtraBodyStr: (val: string) => void;
  onResetEffectiveMaxOutput: () => void;
  testing: boolean;
  testResult: ConnectionTestResult | null;
  onRunTest: (overrideProxy?: boolean) => void;
}

export function ProviderAdvancedFields({
  editedSaved,
  maxOutputTokens,
  onChangeMaxOutput,
  contextTokens,
  onChangeContextTokens,
  tempStr,
  onChangeTempStr,
  useProxy,
  onChangeUseProxy,
  economyMode,
  onChangeEconomyMode,
  strictFormat,
  onChangeStrictFormat,
  extraBodyStr,
  onChangeExtraBodyStr,
  onResetEffectiveMaxOutput,
  testing,
  testResult,
  onRunTest,
}: ProviderAdvancedFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-kalpa-muted mb-1">Max Output</label>
          <input
            type="number"
            value={maxOutputTokens}
            onChange={(e) => onChangeMaxOutput(Number(e.target.value) || 8192)}
            className="w-full min-h-[44px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono tabular-nums text-kalpa-text"
          />
        </div>
        <div>
          <label className="block text-xs text-kalpa-muted mb-1">Context Window</label>
          <input
            type="number"
            value={contextTokens}
            onChange={(e) => onChangeContextTokens(Number(e.target.value) || 128000)}
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
            onChange={(e) => onChangeTempStr(e.target.value)}
            placeholder="Auto"
            className="w-full min-h-[44px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono tabular-nums text-kalpa-text"
          />
        </div>
      </div>

      {editedSaved?.effectiveMaxOutput ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] bg-kalpa-warn/15 border border-kalpa-warn/35 text-xs text-kalpa-text">
          <span>
            Auto-reduced output cap:{' '}
            <strong className="font-mono">{editedSaved.effectiveMaxOutput}</strong> tokens (from key credit limit)
          </span>
          <button
            type="button"
            onClick={onResetEffectiveMaxOutput}
            className="text-kalpa-violet underline font-semibold cursor-pointer shrink-0"
          >
            Reset
          </button>
        </div>
      ) : null}

      <div className="grid sm:grid-cols-3 gap-2 pt-1 text-xs text-kalpa-text">
        <label className="flex items-center gap-2 cursor-pointer select-none min-h-[34px]">
          <input
            type="checkbox"
            checked={useProxy}
            onChange={(e) => onChangeUseProxy(e.target.checked)}
            className="w-4 h-4 accent-kalpa-violet"
          />
          <span>
            Use <code className="font-mono">/api/proxy</code> (CORS)
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none min-h-[34px]">
          <input
            type="checkbox"
            checked={economyMode}
            onChange={(e) => onChangeEconomyMode(e.target.checked)}
            className="w-4 h-4 accent-kalpa-violet"
          />
          <span>Economy mode (4k cap)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none min-h-[34px]">
          <input
            type="checkbox"
            checked={strictFormat}
            onChange={(e) => onChangeStrictFormat(e.target.checked)}
            className="w-4 h-4 accent-kalpa-violet"
          />
          <span>Strict XML format reminder</span>
        </label>
      </div>

      <div>
        <label className="block text-xs text-kalpa-muted mb-1">
          Extra JSON body (optional — merged into provider request, e.g. reasoning effort)
        </label>
        <textarea
          rows={2}
          value={extraBodyStr}
          onChange={(e) => onChangeExtraBodyStr(e.target.value)}
          placeholder='{"reasoning":{"effort":"low"}}'
          className="w-full px-3 py-2 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-xs font-mono text-kalpa-text"
        />
      </div>

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
              PASS · First token: {testResult.ttftMs} ms · Total: {testResult.totalMs} ms · Reply: &ldquo;
              {testResult.reply}&rdquo;
            </p>
          ) : (
            <>
              <p className="text-kalpa-danger font-medium">
                Connection failed ({testResult.totalMs} ms): {testResult.error}
              </p>
              {testResult.suggestProxy ? (
                <Button size="sm" variant="secondary" onClick={() => onRunTest(true)}>
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
          onClick={() => onRunTest()}
        >
          Test connection
        </Button>
        <Button type="submit" variant="primary" leftIcon={<Check className="w-4 h-4" />}>
          Save Profile
        </Button>
      </div>
    </>
  );
}
