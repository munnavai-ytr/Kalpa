'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Check, Plus, Settings } from 'lucide-react';
import { useProviderStore } from '@/lib/providers/store';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { KeySetupCard } from './KeySetupCard';

export interface ModelSwitcherSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ModelSwitcherSheet({ open, onClose }: ModelSwitcherSheetProps) {
  const profiles = useProviderStore((s) => s.profiles);
  const activeProfileId = useProviderStore((s) => s.activeProfileId);
  const setActiveProfile = useProviderStore((s) => s.setActiveProfile);
  const [addingNew, setAddingNew] = useState(false);

  return (
    <Sheet open={open} onClose={onClose} title="Active AI Model" side="bottom">
      <div className="max-w-xl mx-auto space-y-4">
        {profiles.length > 0 && !addingNew ? (
          <>
            <div className="space-y-2">
              {profiles.map((p) => {
                const active = p.id === activeProfileId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setActiveProfile(p.id);
                      onClose();
                    }}
                    className={`w-full flex items-center justify-between gap-3 p-3.5 rounded-[12px] border text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-kalpa-violet bg-kalpa-violet/15'
                        : 'border-kalpa-border bg-kalpa-surface hover:bg-kalpa-surface-2'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-kalpa-text truncate">{p.label}</p>
                      <p className="text-xs font-mono text-kalpa-muted truncate">{p.model}</p>
                    </div>
                    {active ? <Check className="w-4 h-4 text-kalpa-violet shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between pt-2">
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => setAddingNew(true)}
              >
                Add another provider
              </Button>
              <Link
                href="/settings"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 text-xs text-kalpa-muted hover:text-kalpa-text min-h-[38px] px-2"
              >
                <Settings className="w-3.5 h-3.5" />
                Manage all in Settings
              </Link>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <KeySetupCard
              compact
              onSaved={() => {
                setAddingNew(false);
                onClose();
              }}
            />
            {profiles.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setAddingNew(false)}>
                ← Back to saved profiles
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </Sheet>
  );
}
