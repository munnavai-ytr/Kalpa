'use client';

import React from 'react';
import { ClipboardPaste } from 'lucide-react';
import { useTerminalStore } from '@/stores/terminal';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/utils';

export function KeyBar() {
  const sendTerminalInput = useTerminalStore((s) => s.sendTerminalInput);
  const ctrlSticky = useTerminalStore((s) => s.ctrlSticky);
  const altSticky = useTerminalStore((s) => s.altSticky);
  const setCtrlSticky = useTerminalStore((s) => s.setCtrlSticky);
  const setAltSticky = useTerminalStore((s) => s.setAltSticky);
  const addToast = useUiStore((s) => s.addToast);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) sendTerminalInput(text);
    } catch {
      addToast({
        title: 'Clipboard read blocked',
        description: 'Use standard long-press paste inside the terminal.',
        kind: 'warn',
      });
    }
  };

  const btnBase =
    'min-h-[40px] min-w-[38px] px-2.5 rounded-[8px] text-xs font-mono font-medium shrink-0 flex items-center justify-center border transition-colors cursor-pointer select-none';
  const inactiveCls =
    'bg-kalpa-surface border-kalpa-border text-kalpa-text active:bg-kalpa-surface-2';
  const activeCls =
    'bg-kalpa-violet text-white border-kalpa-violet';

  return (
    <div
      role="toolbar"
      aria-label="Terminal touch keys"
      className="flex items-center gap-1.5 px-2 py-1.5 border-t border-kalpa-border bg-kalpa-bg-2 overflow-x-auto shrink-0"
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => sendTerminalInput('\x1b')}
        className={cn(btnBase, inactiveCls)}
      >
        Esc
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => sendTerminalInput('\t')}
        className={cn(btnBase, inactiveCls)}
      >
        Tab
      </button>
      <button
        type="button"
        aria-pressed={ctrlSticky}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setCtrlSticky(!ctrlSticky)}
        className={cn(btnBase, ctrlSticky ? activeCls : inactiveCls)}
      >
        Ctrl
      </button>
      <button
        type="button"
        aria-pressed={altSticky}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setAltSticky(!altSticky)}
        className={cn(btnBase, altSticky ? activeCls : inactiveCls)}
      >
        Alt
      </button>

      <button
        type="button"
        aria-label="Left arrow"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => sendTerminalInput('\x1b[D')}
        className={cn(btnBase, inactiveCls)}
      >
        ←
      </button>
      <button
        type="button"
        aria-label="Down arrow"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => sendTerminalInput('\x1b[B')}
        className={cn(btnBase, inactiveCls)}
      >
        ↓
      </button>
      <button
        type="button"
        aria-label="Up arrow"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => sendTerminalInput('\x1b[A')}
        className={cn(btnBase, inactiveCls)}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label="Right arrow"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => sendTerminalInput('\x1b[C')}
        className={cn(btnBase, inactiveCls)}
      >
        →
      </button>

      {['|', '~', '/', '-'].map((sym) => (
        <button
          key={sym}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => sendTerminalInput(sym)}
          className={cn(btnBase, inactiveCls)}
        >
          {sym}
        </button>
      ))}

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handlePaste}
        className={cn(btnBase, inactiveCls, 'gap-1')}
      >
        <ClipboardPaste className="w-3.5 h-3.5" />
        Paste
      </button>
    </div>
  );
}
