'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    leftIcon,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref
) {
  const variantClasses: Record<ButtonVariant, string> = {
    primary:
      'kalpa-grad-bg text-white font-semibold shadow-kalpa-glow hover:opacity-95 active:scale-[0.98]',
    secondary:
      'bg-kalpa-surface hover:bg-kalpa-surface-2 text-kalpa-text border border-kalpa-border active:scale-[0.98]',
    ghost:
      'bg-transparent hover:bg-kalpa-surface text-kalpa-muted hover:text-kalpa-text active:scale-[0.98]',
    danger:
      'bg-kalpa-danger/15 hover:bg-kalpa-danger/25 text-kalpa-danger border border-kalpa-danger/30 active:scale-[0.98]',
  };

  const sizeClasses: Record<ButtonSize, string> = {
    sm: 'min-h-[38px] px-3 py-1.5 text-xs rounded-[10px] gap-1.5',
    md: 'min-h-[44px] px-4 py-2 text-sm rounded-[10px] gap-2',
    lg: 'min-h-[48px] px-5 py-2.5 text-base rounded-[16px] gap-2.5',
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap shrink-0 font-medium transition-all duration-150 select-none cursor-pointer disabled:opacity-50 disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : leftIcon}
      {children}
    </button>
  );
});
