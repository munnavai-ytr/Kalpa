import React from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({
  glass = false,
  padding = 'md',
  className,
  children,
  ...rest
}: CardProps) {
  const padMap = {
    none: 'p-0',
    sm: 'p-3',
    md: 'p-4 sm:p-5',
    lg: 'p-5 sm:p-6',
  };

  return (
    <div
      className={cn(
        'rounded-[16px] border border-kalpa-border',
        glass ? 'kalpa-glass' : 'bg-kalpa-bg-2',
        padMap[padding],
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
