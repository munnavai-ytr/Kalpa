'use client';

import React, { useEffect } from 'react';

export function AuroraBackground() {
  useEffect(() => {
    const onVisibility = () => {
      document.documentElement.setAttribute(
        'data-tab-hidden',
        document.hidden ? 'true' : 'false'
      );
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none"
    >
      <div
        className="kalpa-blob-1 absolute -top-32 -left-24 w-96 h-96 sm:w-[32rem] sm:h-[32rem] rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, var(--violet) 0%, transparent 70%)' }}
      />
      <div
        className="kalpa-blob-2 absolute top-1/4 -right-28 w-88 h-88 sm:w-[28rem] sm:h-[28rem] rounded-full opacity-18 blur-3xl"
        style={{ background: 'radial-gradient(circle, var(--rose) 0%, transparent 70%)' }}
      />
      <div
        className="kalpa-blob-3 absolute -bottom-36 left-1/3 w-96 h-96 sm:w-[30rem] sm:h-[30rem] rounded-full opacity-15 blur-3xl"
        style={{ background: 'radial-gradient(circle, var(--gold) 0%, transparent 70%)' }}
      />
    </div>
  );
}
