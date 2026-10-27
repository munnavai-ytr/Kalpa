import React, { useId } from 'react';
import { APP_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';

export interface LogoProps {
  showWordmark?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Logo({ showWordmark = true, size = 'md', className }: LogoProps) {
  const gradId = useId();
  const boxSize = size === 'sm' ? 28 : size === 'lg' ? 40 : 32;
  const textClass =
    size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg';

  return (
    <span className={cn('inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none', className)}>
      <svg
        width={boxSize}
        height={boxSize}
        viewBox="0 0 36 36"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id={gradId} x1="2" y1="2" x2="34" y2="34" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFB86B" />
            <stop offset="48%" stopColor="#FF5F9E" />
            <stop offset="100%" stopColor="#7C5CFF" />
          </linearGradient>
        </defs>
        <rect
          x="1.5"
          y="1.5"
          width="33"
          height="33"
          rx="10"
          fill="var(--bg-2)"
          stroke={`url(#${gradId})`}
          strokeWidth="1.75"
        />
        <path
          d="M18.6 6.8C19.2 11.4 23.8 13.7 25.4 18.2C26.8 22.1 24.1 27.6 18.4 28.8C13.1 29.9 9.8 25.4 10.7 20.6C11.3 17.5 13.6 15.6 15.1 13.2C14.7 15.9 16.2 17.6 18.1 18.2C16.9 14.5 16.8 10.2 18.6 6.8Z"
          fill={`url(#${gradId})`}
        />
        <circle cx="22.8" cy="10.2" r="1.6" fill="#FFB86B" />
      </svg>
      {showWordmark ? (
        <span className={cn('font-semibold tracking-tight text-kalpa-text', textClass)}>
          {APP_NAME}
        </span>
      ) : null}
    </span>
  );
}
