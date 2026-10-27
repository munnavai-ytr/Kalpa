'use client';

import React, { useState } from 'react';
import { KeyRound, Plus, Shield, Trash2 } from 'lucide-react';
import { useProviderStore, type ProviderProfile } from '@/lib/providers/store';
import type { VaultMode } from '@/lib/providers/vault';
import { useUiStore } from '@/stores/ui';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';

export interface VaultAndProfilesSectionProps {
  onNewProfile: () => void;
  onEditProfile: (profile: ProviderProfile) => void;
}

export function VaultAndProfilesSection({
  onNewProfile,
  onEditProfile,
}: VaultAndProfilesSectionProps) {
  const profiles = useProviderStore((s) => s.profiles);
  const activeProfileId = useProviderStore((s) => s.activeProfileId);
  const vaultMode = useProviderStore((s) => s.vaultMode);
  const deleteProfile = useProviderStore((s) => s.deleteProfile);
  const removeProfileKey = useProviderStore((s) => s.removeProfileKey);
  const setActiveProfile = useProviderStore((s) => s.setActiveProfile);
  const changeVaultMode = useProviderStore((s) => s.changeVaultMode);
  const addToast = useUiStore((s) => s.addToast);

  const [pendingVaultMode, setPendingVaultMode] = useState<VaultMode>(vaultMode);
  const [vaultPass, setVaultPass] = useState('');

  const handleApplyVault = async () => {
    try {
      await changeVaultMode(pendingVaultMode, vaultPass);
      setVaultPass('');
      addToast({ title: `Key vault updated (${pendingVaultMode})`, kind: 'success' });
    } catch (err) {
      addToast({
        title: 'Vault update failed',
        description: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-kalpa-violet shrink-0" />
          <h3 className="text-sm font-semibold text-kalpa-text">Key Storage Vault</h3>
        </div>
        <div className="grid sm:grid-cols-3 gap-2">
          {(
            [
              { id: 'memory', title: 'Session only', sub: 'Cleared when tab closes' },
              { id: 'device', title: 'This device', sub: 'Saved in IndexedDB' },
              { id: 'encrypted', title: 'Encrypted', sub: 'PBKDF2 + AES-GCM passphrase' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setPendingVaultMode(opt.id)}
              className={`p-3 rounded-[12px] border text-left transition-colors cursor-pointer ${
                pendingVaultMode === opt.id
                  ? 'border-kalpa-violet bg-kalpa-violet/15'
                  : 'border-kalpa-border bg-kalpa-surface hover:bg-kalpa-surface-2'
              }`}
            >
              <p className="text-xs font-semibold text-kalpa-text">{opt.title}</p>
              <p className="text-[11px] text-kalpa-muted mt-0.5">{opt.sub}</p>
            </button>
          ))}
        </div>
        {pendingVaultMode === 'encrypted' ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={vaultPass}
              onChange={(e) => setVaultPass(e.target.value)}
              placeholder="Set encryption passphrase (min 4 chars)…"
              className="flex-1 min-h-[44px] px-3.5 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm text-kalpa-text"
            />
            <Button onClick={handleApplyVault} variant="primary">
              Encrypt &amp; Save Vault
            </Button>
          </div>
        ) : pendingVaultMode !== vaultMode ? (
          <div>
            <Button onClick={handleApplyVault} variant="secondary" size="sm">
              Apply Storage Mode
            </Button>
          </div>
        ) : null}
      </Card>

      {profiles.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-kalpa-text">Saved Profiles</h3>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Plus className="w-3.5 h-3.5" />}
              onClick={onNewProfile}
            >
              New Profile
            </Button>
          </div>
          <div className="grid gap-2">
            {profiles.map((p) => {
              const isActive = p.id === activeProfileId;
              return (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-[14px] bg-kalpa-bg-2 border border-kalpa-border"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-kalpa-text truncate">{p.label}</span>
                      <span className="text-xs text-kalpa-muted">·</span>
                      <span className="text-xs font-mono text-kalpa-muted truncate">{p.model}</span>
                      {isActive ? (
                        <span className="text-xs font-medium text-kalpa-success">· Active</span>
                      ) : null}
                    </div>
                    <p className="text-xs text-kalpa-muted mt-0.5">
                      {p.kind} · {p.apiKey ? 'Key saved' : 'No key'} {p.useProxy ? '· Proxy on' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!isActive ? (
                      <Button size="sm" variant="secondary" onClick={() => setActiveProfile(p.id)}>
                        Set Active
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => onEditProfile(p)}>
                      Edit
                    </Button>
                    {p.apiKey ? (
                      <IconButton
                        label="Remove API key"
                        size="sm"
                        onClick={() => removeProfileKey(p.id)}
                      >
                        <KeyRound className="w-4 h-4" />
                      </IconButton>
                    ) : null}
                    <IconButton
                      label="Delete profile"
                      size="sm"
                      onClick={() => deleteProfile(p.id)}
                    >
                      <Trash2 className="w-4 h-4 text-kalpa-danger" />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
