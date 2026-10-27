'use client';

import { useSyncExternalStore } from 'react';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

export function computeBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  if (w < 700) return 'phone';
  if (w < 1100) return 'tablet';
  return 'desktop';
}

function subscribeBreakpoint(callback: () => void): () => void {
  const mqPhone = window.matchMedia('(max-width: 699px)');
  const mqTablet = window.matchMedia('(min-width: 700px) and (max-width: 1099px)');
  mqPhone.addEventListener('change', callback);
  mqTablet.addEventListener('change', callback);
  window.addEventListener('resize', callback);
  return () => {
    mqPhone.removeEventListener('change', callback);
    mqTablet.removeEventListener('change', callback);
    window.removeEventListener('resize', callback);
  };
}

export function useBreakpoint(): { breakpoint: Breakpoint; hydrated: boolean } {
  const breakpoint = useSyncExternalStore<Breakpoint>(
    subscribeBreakpoint,
    computeBreakpoint,
    () => 'desktop'
  );
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  return { breakpoint, hydrated };
}
