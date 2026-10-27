'use client';

import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from './IconButton';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: 'bottom' | 'left' | 'right';
  children: React.ReactNode;
  className?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  side = 'bottom',
  children,
  className,
}: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const initialAnim =
    side === 'bottom'
      ? { y: '100%' }
      : side === 'left'
        ? { x: '-100%' }
        : { x: '100%' };

  const targetAnim = side === 'bottom' ? { y: 0 } : { x: 0 };

  const posClass =
    side === 'bottom'
      ? 'inset-x-0 bottom-0 rounded-t-[24px] border-t max-h-[88dvh] pb-safe'
      : side === 'left'
        ? 'inset-y-0 left-0 w-[min(86vw,320px)] border-r pt-safe pb-safe'
        : 'inset-y-0 right-0 w-[min(86vw,360px)] border-l pt-safe pb-safe';

  return (
    <AnimatePresence>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-50"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
          />
          <motion.div
            initial={initialAnim}
            animate={targetAnim}
            exit={initialAnim}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className={cn(
              'fixed z-10 flex flex-col bg-kalpa-bg-2 border-kalpa-border shadow-kalpa-soft',
              posClass,
              className
            )}
          >
            {side === 'bottom' ? (
              <div className="w-10 h-1.5 rounded-full bg-kalpa-border mx-auto mt-3 mb-1 shrink-0" />
            ) : null}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-kalpa-border shrink-0">
              <h2 className="text-base font-semibold tracking-tight text-kalpa-text truncate">
                {title}
              </h2>
              <IconButton label="Close sheet" size="sm" onClick={onClose}>
                <X className="w-4 h-4" />
              </IconButton>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
