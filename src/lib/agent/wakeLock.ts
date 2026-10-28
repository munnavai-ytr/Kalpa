export interface WakeLockGuard {
  release: () => Promise<void>;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<{
      released?: boolean;
      release: () => Promise<void>;
      addEventListener?: (type: string, listener: () => void) => void;
    }>;
  };
}

export async function acquireTurnWakeLock(
  enabled: boolean,
  isStillRunning: () => boolean,
  onStateChange: (active: boolean) => void
): Promise<WakeLockGuard> {
  if (!enabled || typeof navigator === 'undefined' || typeof document === 'undefined') {
    onStateChange(false);
    return { release: async () => onStateChange(false) };
  }

  const nav = navigator as unknown as NavigatorWithWakeLock;
  if (!nav.wakeLock?.request) {
    onStateChange(false);
    return { release: async () => onStateChange(false) };
  }

  let sentinel: Awaited<ReturnType<NonNullable<NavigatorWithWakeLock['wakeLock']>['request']>> | null = null;
  let disposed = false;

  const requestLock = async () => {
    if (disposed || !isStillRunning() || document.visibilityState !== 'visible') return;
    try {
      sentinel = await nav.wakeLock!.request('screen');
      onStateChange(true);
      sentinel.addEventListener?.('release', () => {
        if (!disposed) onStateChange(false);
      });
    } catch {
      onStateChange(false);
    }
  };

  const onVisibilityChange = () => {
    if (disposed) return;
    if (document.visibilityState === 'visible' && isStillRunning()) {
      void requestLock();
    } else if (document.visibilityState === 'hidden') {
      onStateChange(false);
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  await requestLock();

  return {
    release: async () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (sentinel) {
        try {
          await sentinel.release();
        } catch {
          // ignore already released
        }
        sentinel = null;
      }
      onStateChange(false);
    },
  };
}
