'use client';

import React from 'react';
import { useUiStore, type ThemeChoice } from '@/stores/ui';
import { Card } from '@/components/ui/Card';

export function AppearanceTab() {
  const theme = useUiStore((s) => s.theme);
  const editorFontSize = useUiStore((s) => s.editorFontSize);
  const editorWordWrap = useUiStore((s) => s.editorWordWrap);
  const reduceMotion = useUiStore((s) => s.reduceMotion);
  const setTheme = useUiStore((s) => s.setTheme);
  const setEditorFontSize = useUiStore((s) => s.setEditorFontSize);
  const setEditorWordWrap = useUiStore((s) => s.setEditorWordWrap);
  const setReduceMotion = useUiStore((s) => s.setReduceMotion);

  const themes: { id: ThemeChoice; label: string }[] = [
    { id: 'dark', label: 'Kalpa Dawn Dark' },
    { id: 'light', label: 'Kalpa Dawn Light' },
    { id: 'system', label: 'Follow System' },
  ];

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-kalpa-text">Color Theme</h3>
        <div className="grid sm:grid-cols-3 gap-2">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={`min-h-[44px] px-4 py-2.5 rounded-[12px] border text-sm font-medium text-left transition-colors cursor-pointer ${
                theme === t.id
                  ? 'border-kalpa-violet bg-kalpa-violet/15 text-kalpa-text'
                  : 'border-kalpa-border bg-kalpa-surface text-kalpa-muted hover:text-kalpa-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-kalpa-text">Code Editor &amp; Motion</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-kalpa-text">Editor font size</p>
              <p className="text-xs text-kalpa-muted">
                Phones automatically enforce at least 16 px to prevent browser input zoom.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditorFontSize(editorFontSize - 1)}
                className="min-h-[40px] min-w-[40px] rounded-[10px] bg-kalpa-surface border border-kalpa-border text-kalpa-text cursor-pointer"
              >
                −
              </button>
              <span className="w-12 text-center text-sm font-mono tabular-nums text-kalpa-text">
                {editorFontSize}px
              </span>
              <button
                type="button"
                onClick={() => setEditorFontSize(editorFontSize + 1)}
                className="min-h-[40px] min-w-[40px] rounded-[10px] bg-kalpa-surface border border-kalpa-border text-kalpa-text cursor-pointer"
              >
                +
              </button>
            </div>
          </div>

          <label className="flex items-center justify-between gap-4 min-h-[44px] cursor-pointer">
            <div>
              <p className="text-sm text-kalpa-text">Soft line wrap</p>
              <p className="text-xs text-kalpa-muted">Wrap long lines inside the code editor</p>
            </div>
            <input
              type="checkbox"
              checked={editorWordWrap}
              onChange={(e) => setEditorWordWrap(e.target.checked)}
              className="w-5 h-5 accent-kalpa-violet"
            />
          </label>

          <label className="flex items-center justify-between gap-4 min-h-[44px] cursor-pointer">
            <div>
              <p className="text-sm text-kalpa-text">Reduce decorative motion</p>
              <p className="text-xs text-kalpa-muted">
                Pause background aurora drift and animated prompt borders
              </p>
            </div>
            <input
              type="checkbox"
              checked={reduceMotion}
              onChange={(e) => setReduceMotion(e.target.checked)}
              className="w-5 h-5 accent-kalpa-violet"
            />
          </label>
        </div>
      </Card>
    </div>
  );
}
