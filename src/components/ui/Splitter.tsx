'use client';

import React, { useRef } from 'react';
import { cn } from '@/lib/utils';

export interface SplitterProps {
  orientation?: 'vertical' | 'horizontal'; // vertical = divides left/right; horizontal = divides top/bottom
  onDelta: (deltaPx: number) => void;
  onReset?: () => void;
  label: string;
  className?: string;
}

export function Splitter({
  orientation = 'vertical',
  onDelta,
  onReset,
  label,
  className,
}: SplitterProps) {
  const lastPosRef = useRef<number | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    lastPosRef.current = orientation === 'vertical' ? e.clientX : e.clientY;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (lastPosRef.current === null) return;
    const current = orientation === 'vertical' ? e.clientX : e.clientY;
    const delta = current - lastPosRef.current;
    if (delta !== 0) {
      lastPosRef.current = current;
      onDelta(delta);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (lastPosRef.current !== null) {
      lastPosRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if already released
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 12;
    if (orientation === 'vertical') {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onDelta(-step);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onDelta(step);
      }
    } else {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onDelta(-step);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        onDelta(step);
      }
    }
  };

  const isVert = orientation === 'vertical';

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={isVert ? 'vertical' : 'horizontal'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative z-20 flex items-center justify-center touch-none select-none transition-colors',
        isVert ? 'w-2 cursor-col-resize h-full -mx-1' : 'h-2 cursor-row-resize w-full -my-1',
        className
      )}
    >
      <div
        className={cn(
          'bg-kalpa-border group-hover:bg-kalpa-violet group-active:bg-kalpa-violet transition-colors',
          isVert ? 'w-[1px] group-hover:w-[2px] h-full' : 'h-[1px] group-hover:h-[2px] w-full'
        )}
      />
    </div>
  );
}
