'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  size?: 'sm' | 'md';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active = false, size = 'md', className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center shrink-0 rounded-[10px] transition-colors duration-150 cursor-pointer select-none disabled:opacity-45 disabled:pointer-events-none',
        size === 'md' ? 'min-h-[44px] min-w-[44px] p-2' : 'min-h-[36px] min-w-[36px] p-1.5',
        active
          ? 'bg-kalpa-violet/20 text-kalpa-violet border border-kalpa-violet/40'
          : 'text-kalpa-muted hover:text-kalpa-text hover:bg-kalpa-surface',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
