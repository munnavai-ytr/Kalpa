'use client';

import React, { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { APP_NAME, TAGLINE } from '@/lib/brand';
import { getKalpaDB } from '@/lib/vfs/db';
import { useProviderStore } from '@/lib/providers/store';
import { useUiStore } from '@/stores/ui';
import { useViewportHeight } from '@/hooks/useViewportHeight';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

const BOOT_SESSION_KEY = 'kalpa_cold_boot_done';

export function BootLoader({ children }: { children: React.ReactNode }) {
  useViewportHeight();
  const gradId = useId();
  const hydrateAppearance = useUiStore((s) => s.hydrateAppearance);
  const initProviders = useProviderStore((s) => s.initProviders);
  const vaultLocked = useProviderStore((s) => s.vaultLocked);
  const unlockVault = useProviderStore((s) => s.unlockVault);
  const addToast = useUiStore((s) => s.addToast);

  const [showBoot, setShowBoot] = useState(false);
  const [statusText, setStatusText] = useState('Opening browser database…');
  const [passphrase, setPassphrase] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    hydrateAppearance();
    const alreadyBooted =
      typeof sessionStorage !== 'undefined' && sessionStorage.getItem(BOOT_SESSION_KEY) === '1';

    if (!alreadyBooted) {
      setShowBoot(true);
    }

    let cancelled = false;
    const startMs = performance.now();

    (async () => {
      try {
        setStatusText('Opening Kalpa IndexedDB…');
        await getKalpaDB();
        if (cancelled) return;
        setStatusText('Loading provider vault…');
        await initProviders();
        if (cancelled) return;
        setStatusText('Ready');
      } catch {
        if (!cancelled) setStatusText('Ready (storage fallback)');
      } finally {
        if (!alreadyBooted && !cancelled) {
          const elapsed = performance.now() - startMs;
          const remaining = Math.max(0, 1150 - elapsed);
          setTimeout(() => {
            if (!cancelled) {
              try {
                sessionStorage.setItem(BOOT_SESSION_KEY, '1');
              } catch {
                // ignore
              }
              setShowBoot(false);
            }
          }, remaining);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrateAppearance, initProviders]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      await unlockVault(passphrase);
      setPassphrase('');
      addToast({ title: 'Key vault unlocked', kind: 'success' });
    } catch {
      setUnlockError('Incorrect passphrase. Please try again.');
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <>
      {children}

      <AnimatePresence>
        {showBoot ? (
          <motion.div
            key="kalpa-bootloader"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28 }}
            className="fixed inset-0 z-70 flex flex-col items-center justify-center bg-kalpa-bg px-6 select-none"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.35 }}
              className="relative flex flex-col items-center gap-4"
            >
              <div className="relative rounded-[20px] p-4 shadow-kalpa-glow">
                <svg width="64" height="64" viewBox="0 0 36 36" fill="none">
                  <defs>
                    <linearGradient id={gradId} x1="2" y1="2" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#FFB86B" />
                      <stop offset="48%" stopColor="#FF5F9E" />
                      <stop offset="100%" stopColor="#7C5CFF" />
                    </linearGradient>
                  </defs>
                  <motion.rect
                    x="1.5"
                    y="1.5"
                    width="33"
                    height="33"
                    rx="10"
                    stroke={`url(#${gradId})`}
                    strokeWidth="1.8"
                    fill="var(--bg-2)"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.7, ease: 'easeInOut' }}
                  />
                  <motion.path
                    d="M18.6 6.8C19.2 11.4 23.8 13.7 25.4 18.2C26.8 22.1 24.1 27.6 18.4 28.8C13.1 29.9 9.8 25.4 10.7 20.6C11.3 17.5 13.6 15.6 15.1 13.2C14.7 15.9 16.2 17.6 18.1 18.2C16.9 14.5 16.8 10.2 18.6 6.8Z"
                    stroke={`url(#${gradId})`}
                    strokeWidth="1.5"
                    fill={`url(#${gradId})`}
                    initial={{ pathLength: 0, fillOpacity: 0 }}
                    animate={{ pathLength: 1, fillOpacity: 1 }}
                    transition={{ duration: 0.85, ease: 'easeOut' }}
                  />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-xl font-semibold tracking-tight text-kalpa-text">{APP_NAME}</p>
                <p className="mt-0.5 text-xs text-kalpa-muted">{TAGLINE}</p>
              </div>
              <p className="mt-2 text-xs font-mono text-kalpa-muted">{statusText}</p>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Modal
        open={!showBoot && vaultLocked}
        onClose={() => {}}
        title="Unlock Encrypted Key Vault"
        description="Enter your passphrase to decrypt your saved API keys for this session."
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <label htmlFor="vault-pass" className="block text-xs font-medium text-kalpa-muted mb-1.5">
              Passphrase
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-kalpa-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="vault-pass"
                type="password"
                autoFocus
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase…"
                className="w-full min-h-[44px] pl-10 pr-3.5 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-base text-kalpa-text placeholder:text-kalpa-muted focus:outline-none focus:border-kalpa-violet"
              />
            </div>
            {unlockError ? (
              <p className="mt-1.5 text-xs text-kalpa-danger">{unlockError}</p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="submit" variant="primary" loading={unlocking}>
              Unlock Keys
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
