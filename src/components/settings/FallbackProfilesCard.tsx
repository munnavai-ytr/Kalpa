'use client';

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Layers, Plus, X } from 'lucide-react';
import { useProviderStore } from '@/lib/providers/store';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';

export function FallbackProfilesCard() {
  const profiles = useProviderStore((s) => s.profiles);
  const activeProfileId = useProviderStore((s) => s.activeProfileId);
  const fallbackProfileIds = useProviderStore((s) => s.fallbackProfileIds);
  const autoSwitchOnQuota = useProviderStore((s) => s.autoSwitchOnQuota);
  const setFallbackProfileIds = useProviderStore((s) => s.setFallbackProfileIds);
  const setAutoSwitchOnQuota = useProviderStore((s) => s.setAutoSwitchOnQuota);

  const [selectedCandidate, setSelectedCandidate] = useState('');

  if (profiles.length < 2) {
    return (
      <Card className="space-y-2">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-kalpa-violet shrink-0" />
          <h3 className="text-sm font-semibold text-kalpa-text">Automatic Quota Fallbacks</h3>
        </div>
        <p className="text-xs text-kalpa-muted leading-relaxed">
          Save a second provider profile above to enable automatic failover when a free-tier or low-credit key hits a daily quota or credit limit.
        </p>
      </Card>
    );
  }

  const availableToAdd = profiles.filter(
    (p) => p.id !== activeProfileId && !fallbackProfileIds.includes(p.id)
  );

  const addFallback = async () => {
    const idToAdd = selectedCandidate || availableToAdd[0]?.id;
    if (!idToAdd) return;
    await setFallbackProfileIds([...fallbackProfileIds, idToAdd]);
    setSelectedCandidate('');
  };

  const moveItem = async (idx: number, delta: -1 | 1) => {
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= fallbackProfileIds.length) return;
    const copy = [...fallbackProfileIds];
    const [picked] = copy.splice(idx, 1);
    copy.splice(nextIdx, 0, picked);
    await setFallbackProfileIds(copy);
  };

  const removeItem = async (id: string) => {
    await setFallbackProfileIds(fallbackProfileIds.filter((x) => x !== id));
  };

  return (
    <Card className="space-y-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-kalpa-violet shrink-0" />
          <h3 className="text-sm font-semibold text-kalpa-text">Automatic Quota Fallbacks</h3>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-kalpa-text cursor-pointer">
          <input
            type="checkbox"
            checked={autoSwitchOnQuota}
            onChange={(e) => setAutoSwitchOnQuota(e.target.checked)}
            className="w-4 h-4 accent-kalpa-violet"
          />
          Auto-switch on quota error
        </label>
      </div>

      <p className="text-xs text-kalpa-muted leading-relaxed">
        When your active key hits daily quota, zero free quota, or runs out of credit, Kalpa automatically switches to the next profile in this ordered list.
      </p>

      {fallbackProfileIds.length > 0 ? (
        <div className="space-y-1.5">
          {fallbackProfileIds.map((fid, idx) => {
            const prof = profiles.find((p) => p.id === fid);
            if (!prof) return null;
            return (
              <div
                key={fid}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-kalpa-violet font-semibold">#{idx + 1}</span>
                  <span className="font-medium text-kalpa-text truncate">{prof.label}</span>
                  <span className="font-mono text-kalpa-muted truncate">· {prof.model}</span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <IconButton
                    label="Move fallback up"
                    size="sm"
                    disabled={idx === 0}
                    onClick={() => moveItem(idx, -1)}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton
                    label="Move fallback down"
                    size="sm"
                    disabled={idx === fallbackProfileIds.length - 1}
                    onClick={() => moveItem(idx, 1)}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton
                    label="Remove from fallbacks"
                    size="sm"
                    onClick={() => removeItem(fid)}
                  >
                    <X className="w-3.5 h-3.5 text-kalpa-danger" />
                  </IconButton>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs font-mono text-kalpa-subtle">No fallback profiles selected yet.</p>
      )}

      {availableToAdd.length > 0 ? (
        <div className="flex items-center gap-2 pt-1">
          <select
            aria-label="Choose fallback profile"
            value={selectedCandidate || availableToAdd[0].id}
            onChange={(e) => setSelectedCandidate(e.target.value)}
            className="flex-1 min-h-[38px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-xs text-kalpa-text"
          >
            {availableToAdd.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.model}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            onClick={addFallback}
          >
            Add fallback
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
