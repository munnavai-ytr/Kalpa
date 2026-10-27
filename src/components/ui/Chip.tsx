'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: React.ReactNode;
}

export function Chip({
  active = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-[10px] text-xs font-medium whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer select-none border',
        active
          ? 'bg-kalpa-violet/20 border-kalpa-violet/50 text-kalpa-text'
          : 'bg-kalpa-surface border-kalpa-border text-kalpa-muted hover:text-kalpa-text hover:bg-kalpa-surface-2',
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
