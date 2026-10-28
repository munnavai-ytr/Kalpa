'use client';

import React from 'react';
import { KeyRound } from 'lucide-react';
import { isOpenRouterUrl } from '@/lib/providers/credits';
import { useProviderStore } from '@/lib/providers/store';
import { Chip } from '@/components/ui/Chip';

export interface ModelChipProps {
  onClick: () => void;
  compact?: boolean;
  className?: string;
}

export function ModelChip({ onClick, compact = false, className = '' }: ModelChipProps) {
  const profiles = useProviderStore((s) => s.profiles);
  const activeProfileId = useProviderStore((s) => s.activeProfileId);
  const openRouterCredits = useProviderStore((s) => s.openRouterCredits);

  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;

  if (!activeProfile) {
    return (
      <Chip onClick={onClick} active={false} icon={<KeyRound className="w-3.5 h-3.5" />} className={className}>
        <span className="truncate">Add key</span>
      </Chip>
    );
  }

  const routeBadge = activeProfile.useProxy ? 'Proxy' : 'Direct';
  const creditInfo = isOpenRouterUrl(activeProfile.baseUrl)
    ? openRouterCredits[activeProfile.id]
    : undefined;
  const remaining = creditInfo?.limitRemaining;
  const creditLabel =
    typeof remaining === 'number' && Number.isFinite(remaining)
      ? `$${remaining < 1 ? remaining.toFixed(3) : remaining.toFixed(2)}`
      : null;

  const titleParts = [
    `${activeProfile.label} · ${activeProfile.model}`,
    `Mode: ${routeBadge}`,
  ];
  if (creditLabel) titleParts.push(`Credit left: ${creditLabel}`);
  if (activeProfile.effectiveMaxOutput) {
    titleParts.push(`Auto output cap: ${activeProfile.effectiveMaxOutput} tok`);
  }

  return (
    <Chip
      onClick={onClick}
      active
      icon={<KeyRound className="w-3 h-3 shrink-0" />}
      title={titleParts.join(' · ')}
      className={className}
    >
      <span className="truncate">
        {compact ? activeProfile.model : `${activeProfile.label} · ${activeProfile.model}`}
      </span>
      <span className="text-[10px] font-mono opacity-80 shrink-0">· {routeBadge}</span>
      {!compact && creditLabel ? (
        <span className="text-[10px] font-mono text-kalpa-gold shrink-0 tabular-nums">
          · {creditLabel}
        </span>
      ) : null}
    </Chip>
  );
}
