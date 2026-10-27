'use client';

import React from 'react';
import { Code2, Eye, MessageSquare, Terminal } from 'lucide-react';
import { useUiStore, type IdeTab } from '@/stores/ui';
import { usePreviewStore } from '@/stores/preview';
import { cn } from '@/lib/utils';

const ITEMS: { id: IdeTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'code', label: 'Code', Icon: Code2 },
  { id: 'preview', label: 'Preview', Icon: Eye },
  { id: 'terminal', label: 'Terminal', Icon: Terminal },
];

export function BottomNav() {
  const activeIdeTab = useUiStore((s) => s.activeIdeTab);
  const setActiveIdeTab = useUiStore((s) => s.setActiveIdeTab);
  const entries = usePreviewStore((s) => s.entries);
  const hasErrors = entries.some((e) => e.level === 'error');

  return (
    <nav
      aria-label="Workspace panels"
      className="shrink-0 bg-kalpa-bg-2/95 backdrop-blur-md border-t border-kalpa-border pb-safe z-30"
    >
      <div className="grid grid-cols-4 h-14">
        {ITEMS.map(({ id, label, Icon }) => {
          const active = activeIdeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveIdeTab(id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex flex-col items-center justify-center gap-0.5 min-h-[44px] transition-colors cursor-pointer select-none',
                active ? 'text-kalpa-violet' : 'text-kalpa-muted hover:text-kalpa-text'
              )}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {id === 'preview' && hasErrors ? (
                  <span
                    aria-label="Preview has errors"
                    className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-kalpa-danger"
                  />
                ) : null}
              </div>
              <span className="text-[11px] font-medium tracking-tight">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
