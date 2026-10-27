'use client';

import React, { useEffect, useRef } from 'react';
import { SandpackPreview, SandpackProvider, useSandpack } from '@codesandbox/sandpack-react';

export interface SandpackSelfTestProps {
  runNonce: number;
  onResult: (res: { ok: boolean; durationMs: number; detail: string }) => void;
}

function SelfTestWatcher({
  onResult,
}: {
  onResult: SandpackSelfTestProps['onResult'];
}) {
  const { listen } = useSandpack();
  const doneRef = useRef(false);

  useEffect(() => {
    const startTime = performance.now();
    const timeout = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onResult({
        ok: false,
        durationMs: Math.round(performance.now() - startTime),
        detail: 'Timed out after 20s waiting for Sandpack bundler done event',
      });
    }, 20000);

    const unsub = listen((msg: any) => {
      if (doneRef.current) return;
      if (msg.type === 'done' && !msg.compilatonError) {
        doneRef.current = true;
        clearTimeout(timeout);
        onResult({
          ok: true,
          durationMs: Math.round(performance.now() - startTime),
          detail: 'Sandpack static react template compiled and rendered',
        });
      } else if (msg.type === 'action' && msg.action === 'show-error') {
        doneRef.current = true;
        clearTimeout(timeout);
        onResult({
          ok: false,
          durationMs: Math.round(performance.now() - startTime),
          detail: msg.message || 'Bundler reported compilation error',
        });
      }
    });

    return () => {
      clearTimeout(timeout);
      unsub();
    };
  }, [listen, onResult]);

  return null;
}

export function SandpackSelfTest({ runNonce, onResult }: SandpackSelfTestProps) {
  return (
    <div className="h-24 w-full rounded-[10px] overflow-hidden border border-kalpa-border">
      <SandpackProvider
        key={`diag-sp-${runNonce}`}
        template="react"
        files={{
          '/App.js': `export default function App() {
  return <div style={{ fontFamily: 'system-ui', padding: 12, fontSize: 13 }}>Sandpack Self-Test Active</div>;
}`,
        }}
        options={{ autorun: true }}
      >
        <SandpackPreview
          showNavigator={false}
          showRefreshButton={false}
          showOpenInCodeSandbox={false}
          style={{ height: 96 }}
        />
        <SelfTestWatcher onResult={onResult} />
      </SandpackProvider>
    </div>
  );
}
