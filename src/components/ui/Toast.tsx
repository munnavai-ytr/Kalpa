'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/utils';

export function ToastViewport() {
  const toasts = useUiStore((s) => s.toasts);
  const dismissToast = useUiStore((s) => s.dismissToast);

  return (
    <div
      aria-live="polite"
      className="fixed bottom-18 sm:bottom-5 right-4 left-4 sm:left-auto sm:w-90 z-60 flex flex-col gap-2 pointer-events-none"
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const kind = toast.kind ?? 'info';
          const Icon =
            kind === 'success'
              ? CheckCircle2
              : kind === 'error' || kind === 'warn'
                ? AlertCircle
                : Info;
          const iconColor =
            kind === 'success'
              ? 'text-kalpa-success'
              : kind === 'warn'
                ? 'text-kalpa-warn'
                : kind === 'error'
                  ? 'text-kalpa-danger'
                  : 'text-kalpa-violet';

          return (
            <motion.div
              key={toast.id}
              role="status"
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className={cn(
                'pointer-events-auto flex items-start gap-3 p-3.5 rounded-[14px] bg-kalpa-bg-2 border border-kalpa-border shadow-kalpa-soft'
              )}
            >
              <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', iconColor)} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-kalpa-text">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-xs text-kalpa-muted break-words">
                    {toast.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismissToast(toast.id)}
                className="p-1 text-kalpa-muted hover:text-kalpa-text rounded-md cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
