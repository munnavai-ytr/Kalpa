'use client';

import React, { useEffect } from 'react';
import { Bot, Smartphone, Sparkles } from 'lucide-react';
import { useAgentStore, type IdleTimeoutOption } from '@/stores/agent';
import { Card } from '@/components/ui/Card';

const IDLE_OPTIONS: { value: IdleTimeoutOption; label: string }[] = [
  { value: 60000, label: '60 s' },
  { value: 120000, label: '120 s (default)' },
  { value: 300000, label: '300 s' },
];

export function AgentTab() {
  const prefs = useAgentStore((s) => s.prefs);
  const hydratePrefs = useAgentStore((s) => s.hydratePrefs);
  const updatePrefs = useAgentStore((s) => s.updatePrefs);

  useEffect(() => {
    hydratePrefs();
  }, [hydratePrefs]);

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <div className="flex items-center gap-2.5">
          <Bot className="w-4 h-4 text-kalpa-violet shrink-0" />
          <h3 className="text-sm font-semibold text-kalpa-text">
            Milestone Execution &amp; Self-Repair
          </h3>
        </div>

        <p className="text-sm text-kalpa-muted leading-relaxed">
          Configure how Kalpa&apos;s step-by-step agent executes multi-milestone plans, verifies
          preview builds, and renders action cards in Chat.
        </p>

        <div className="space-y-4 pt-1">
          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-kalpa-text">Auto-continue milestones</p>
              <p className="text-xs text-kalpa-muted">
                Automatically start the next milestone when a turn emits{' '}
                <code className="font-mono">&lt;complete next=&quot;M2&quot; /&gt;</code>.
              </p>
            </div>
            <input
              type="checkbox"
              checked={prefs.autoContinue}
              onChange={(e) => updatePrefs({ autoContinue: e.target.checked })}
              className="mt-1 w-4 h-4 rounded accent-kalpa-violet shrink-0"
            />
          </label>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-kalpa-text">Max auto-continue milestones per run</span>
              <span className="font-mono font-semibold text-kalpa-violet">{prefs.maxAutoMilestones}</span>
            </div>
            <input
              type="range"
              min={1}
              max={25}
              value={prefs.maxAutoMilestones}
              onChange={(e) => updatePrefs({ maxAutoMilestones: Number(e.target.value) })}
              className="w-full accent-kalpa-violet"
            />
            <p className="text-[11px] text-kalpa-muted">
              Hard ceiling before pausing for manual confirmation (default: 10).
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-kalpa-text">Max automatic repair attempts per turn</span>
              <span className="font-mono font-semibold text-kalpa-violet">{prefs.maxRepairAttempts}</span>
            </div>
            <input
              type="range"
              min={1}
              max={8}
              value={prefs.maxRepairAttempts}
              onChange={(e) => updatePrefs({ maxRepairAttempts: Number(e.target.value) })}
              className="w-full accent-kalpa-violet"
            />
            <p className="text-[11px] text-kalpa-muted">
              Stops repeating repairs if the exact same compile/runtime error occurs 3 times.
            </p>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2.5">
          <Smartphone className="w-4 h-4 text-kalpa-success shrink-0" />
          <h3 className="text-sm font-semibold text-kalpa-text">
            Phone Reliability, Timeouts &amp; Economy Mode
          </h3>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-kalpa-text">
              Stream idle byte watchdog
            </label>
            <p className="text-xs text-kalpa-muted">
              Only triggers a timeout if zero bytes (including SSE keepalive pings) arrive for this duration. Long builds never time out while streaming.
            </p>
            <div className="grid grid-cols-3 gap-2 pt-1">
              {IDLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updatePrefs({ idleTimeoutMs: opt.value })}
                  className={`min-h-[40px] px-3 rounded-[10px] border text-xs font-mono cursor-pointer transition-colors ${
                    prefs.idleTimeoutMs === opt.value
                      ? 'border-kalpa-violet bg-kalpa-violet/15 text-kalpa-text font-semibold'
                      : 'border-kalpa-border bg-kalpa-surface text-kalpa-muted hover:text-kalpa-text'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-kalpa-text">
                Keep screen awake while building
              </p>
              <p className="text-xs text-kalpa-muted">
                Uses the browser Screen Wake Lock API during active turns so mobile screens do not sleep mid-stream.
              </p>
            </div>
            <input
              type="checkbox"
              checked={prefs.keepScreenAwake}
              onChange={(e) => updatePrefs({ keepScreenAwake: e.target.checked })}
              className="mt-1 w-4 h-4 rounded accent-kalpa-violet shrink-0"
            />
          </label>

          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-kalpa-text">
                Economy mode (low-credit &amp; free-tier saver)
              </p>
              <p className="text-xs text-kalpa-muted">
                Caps output requests at 4,096 tokens, trims selected file context by 40%, and skips extra background summary calls.
              </p>
            </div>
            <input
              type="checkbox"
              checked={prefs.economyMode}
              onChange={(e) => updatePrefs({ economyMode: e.target.checked })}
              className="mt-1 w-4 h-4 rounded accent-kalpa-violet shrink-0"
            />
          </label>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-kalpa-gold shrink-0" />
          <h3 className="text-sm font-semibold text-kalpa-text">Action Card Display</h3>
        </div>

        <label className="flex items-start justify-between gap-4 cursor-pointer">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-kalpa-text">
              Expand file diffs &amp; shell output by default
            </p>
            <p className="text-xs text-kalpa-muted">
              When off, action cards stay compact and expand on click (recommended for mobile).
            </p>
          </div>
          <input
            type="checkbox"
            checked={prefs.expandActionCards}
            onChange={(e) => updatePrefs({ expandActionCards: e.target.checked })}
            className="mt-1 w-4 h-4 rounded accent-kalpa-violet shrink-0"
          />
        </label>
      </Card>
    </div>
  );
}
